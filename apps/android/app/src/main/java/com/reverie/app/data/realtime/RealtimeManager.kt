package com.reverie.app.data.realtime

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.di.ApplicationScope
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Socket.IO client for the `job:*` event stream. The server authenticates the handshake with
 * the access token (sent via `auth.token`) and scopes rooms to the user, so we send a fresh
 * token on each (re)connect and refresh-then-reconnect on an auth rejection. The server does
 * not remember subscriptions, so we also re-emit every active subscription on each (re)connect.
 * The socket is only connected while the app is foregrounded AND at least one room is
 * subscribed; uploads use HTTP and don't need it.
 */
@Singleton
class RealtimeManager @Inject constructor(
    private val serverUrlProvider: ServerUrlProvider,
    private val authSession: AuthSessionManager,
    @ApplicationScope private val scope: CoroutineScope,
) : DefaultLifecycleObserver {

    private data class Room(
        val subscribeEvent: String,
        val unsubscribeEvent: String,
        val payloadKey: String,
        val id: String,
    )

    private val mutex = Mutex()
    private val rooms = mutableMapOf<String, Pair<Room, Int>>() // key -> (room, refCount)
    private var socket: Socket? = null
    private var foreground = false
    private val refreshingAuth = AtomicBoolean(false)

    private val _events = MutableSharedFlow<JobEventDto>(extraBufferCapacity = 128)
    val events: SharedFlow<JobEventDto> = _events.asSharedFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    init {
        scope.launch(Dispatchers.Main) {
            ProcessLifecycleOwner.get().lifecycle.addObserver(this@RealtimeManager)
        }
    }

    override fun onStart(owner: LifecycleOwner) {
        scope.launch { mutex.withLock { foreground = true; ensureConnection() } }
    }

    override fun onStop(owner: LifecycleOwner) {
        scope.launch { mutex.withLock { foreground = false; teardown() } }
    }

    suspend fun subscribeDocument(documentId: String): AutoCloseable =
        subscribe(Room("subscribe:document", "unsubscribe:document", "document_id", documentId))

    suspend fun subscribeSession(sessionId: String): AutoCloseable =
        subscribe(Room("subscribe:session", "unsubscribe:session", "session_id", sessionId))

    private suspend fun subscribe(room: Room): AutoCloseable {
        val key = "${room.subscribeEvent}:${room.id}"
        mutex.withLock {
            val existing = rooms[key]
            rooms[key] = if (existing == null) room to 1 else existing.first to (existing.second + 1)
            ensureConnection()
            if (_connected.value) emitSubscribe(room)
        }
        return AutoCloseable {
            scope.launch {
                mutex.withLock {
                    val entry = rooms[key] ?: return@withLock
                    val count = entry.second - 1
                    if (count <= 0) {
                        rooms.remove(key)
                        if (_connected.value) emitUnsubscribe(room)
                        if (rooms.isEmpty()) teardown()
                    } else {
                        rooms[key] = entry.first to count
                    }
                }
            }
        }
    }

    /** Caller must hold [mutex]. */
    private fun ensureConnection() {
        if (!foreground || rooms.isEmpty() || socket != null) return
        val uri = runCatching { URI.create(serverUrlProvider.current().removeSuffix("/")) }.getOrNull() ?: return
        val options = IO.Options().apply {
            transports = arrayOf("websocket", "polling")
            reconnection = true
            // The server verifies this on the handshake; read fresh so a rebuild after a
            // token refresh picks up the new token.
            auth = mapOf("token" to (authSession.currentAccessToken() ?: ""))
        }
        val newSocket = runCatching { IO.socket(uri, options) }.getOrNull() ?: return
        socket = newSocket

        newSocket.on(Socket.EVENT_CONNECT) { onSocketConnected() }
        newSocket.on(Socket.EVENT_DISCONNECT) { _connected.value = false }
        newSocket.on(Socket.EVENT_CONNECT_ERROR) { args -> onConnectError(args) }
        JOB_EVENTS.forEach { event ->
            newSocket.on(event) { args -> handleEvent(args) }
        }
        newSocket.connect()
    }

    /** Caller must hold [mutex]. */
    private fun teardown() {
        socket?.let { s ->
            s.off()
            s.disconnect()
            s.close()
        }
        socket = null
        _connected.value = false
    }

    private fun onSocketConnected() {
        scope.launch {
            mutex.withLock {
                _connected.value = true
                rooms.values.forEach { (room, _) -> emitSubscribe(room) }
            }
        }
    }

    /**
     * The handshake middleware rejects an invalid/expired token with an "unauthorized" error.
     * Transport/network errors retry on their own, so only a token rejection triggers a
     * single-flight refresh + rebuild so the next handshake carries the fresh token.
     */
    private fun onConnectError(args: Array<out Any?>) {
        val arg = args.firstOrNull()
        val message = when (arg) {
            is JSONObject -> arg.optString("message")
            is Exception -> arg.message.orEmpty()
            else -> arg?.toString().orEmpty()
        }

        if (!message.contains("unauthorized", ignoreCase = true)) return

        if (!refreshingAuth.compareAndSet(false, true)) return

        scope.launch {
            try {
                val refreshed = authSession.refresh(authSession.currentAccessToken())
                mutex.withLock {
                    if (refreshed && foreground && rooms.isNotEmpty()) {
                        teardown()
                        ensureConnection()
                    }
                }
            } finally {
                refreshingAuth.set(false)
            }
        }
    }

    private fun emitSubscribe(room: Room) {
        socket?.emit(room.subscribeEvent, JSONObject().put(room.payloadKey, room.id))
    }

    private fun emitUnsubscribe(room: Room) {
        socket?.emit(room.unsubscribeEvent, JSONObject().put(room.payloadKey, room.id))
    }

    private fun handleEvent(args: Array<out Any?>) {
        val payload = args.firstOrNull() as? JSONObject ?: return
        val event = runCatching {
            ApiJson.decodeFromString(JobEventDto.serializer(), payload.toString())
        }.getOrNull() ?: return
        _events.tryEmit(event)
    }

    private companion object {
        val JOB_EVENTS = listOf("job:started", "job:progress", "job:complete", "job:failed")
    }
}
