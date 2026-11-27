package com.reverie.app.ui.components

import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.repository.UnlockOutcome
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

class FolderUnlockerTest {

    private val world = FavouriteWorld().apply { secretKind = LockSecretKind.PIN }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val opened = CopyOnWriteArrayList<String>()
    private val unlocker = FolderUnlocker(world.vault, scope) { opened += it }

    @After fun tearDown() = scope.cancel()

    private fun run(body: suspend () -> Unit) = runBlocking { withTimeout(5_000) { body() } }

    private fun refuse(ask: String, triesLeft: Int?) {
        world.vaultRefusals += HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"invalid_credentials","message":"No","details":{"ask":"$ask","tries_left":$triesLeft}}"""
    }

    /** The prompt once the try in flight has been answered. */
    private suspend fun answered(): FolderUnlockPrompt = unlocker.prompt.first { it != null && !it.isBusy }!!

    private fun asked(prompt: FolderUnlockPrompt): LockAsk? = (prompt.lock as LockCheck.Known).status.ask

    private fun tries() = world.requests.count { it.startsWith("POST vault/unlock") }

    @Test fun `an opened lock shows no error`() {
        assertNull(UnlockOutcome.Unlocked.toPromptError(LockAsk.PIN))
        assertNull(UnlockOutcome.NotPrivate.toPromptError(LockAsk.PIN))
    }

    @Test fun `a wrong PIN or lock password says how many tries are left`() {
        assertEquals(
            "Incorrect PIN. 7 tries left.",
            UnlockOutcome.WrongSecret(LockSecretKind.PIN, 7).toPromptError(LockAsk.PIN),
        )
        assertEquals(
            "Incorrect password. 1 try left.",
            UnlockOutcome.WrongSecret(LockSecretKind.PASSWORD, 1).toPromptError(LockAsk.PASSWORD),
        )
    }

    @Test fun `a wrong account password is explained where that is what was asked`() {
        assertEquals("Incorrect password. Try again.", UnlockOutcome.WrongPassword.toPromptError(LockAsk.ACCOUNT_PASSWORD))
        assertEquals("Incorrect password. Try again.", UnlockOutcome.Stopped.toPromptError(LockAsk.ACCOUNT_PASSWORD))
    }

    @Test fun `a refusal that turns to the account password adds no line of its own`() {
        assertNull(UnlockOutcome.Stopped.toPromptError(LockAsk.PIN))
        assertNull(UnlockOutcome.WrongPassword.toPromptError(LockAsk.PASSWORD))
    }

    @Test fun `an account without a password and a failure say so`() {
        assertEquals("Your account has no password yet.", UnlockOutcome.NoPassword.toPromptError(LockAsk.PIN))
        assertEquals("Offline", UnlockOutcome.Failed("Offline").toPromptError(LockAsk.PIN))
    }

    @Test fun `a prompt reads what the lock takes before it takes anything`() = run {
        val gate = CompletableDeferred<Unit>()
        world.vaultGate = gate

        unlocker.request("f", "Taxes")
        assertEquals(LockCheck.Checking, unlocker.prompt.value?.lock)
        unlocker.submit("4821")
        gate.complete(Unit)

        assertEquals(LockAsk.PIN, asked(unlocker.awaitForm()))
        assertEquals(0, tries())
    }

    @Test fun `a lock that cannot be read takes nothing, and can be read again`() = run {
        world.isStatusDown = true
        unlocker.request("f")
        unlocker.prompt.first { it?.lock == LockCheck.Failed }

        unlocker.submit("4821")
        world.isStatusDown = false
        unlocker.retry()

        assertEquals(LockAsk.PIN, asked(unlocker.awaitForm()))
        assertEquals(0, tries())
    }

    @Test fun `a prompt opened after the kind changed elsewhere asks for the new kind`() = run {
        unlocker.request("f")
        unlocker.awaitForm()
        unlocker.dismiss()
        world.secretKind = LockSecretKind.PASSWORD

        unlocker.request("f")

        assertEquals(LockAsk.PASSWORD, asked(unlocker.awaitForm()))
    }

    @Test fun `asking again for the open folder keeps its prompt, and another folder gets its own`() = run {
        unlocker.request("f", "Taxes")
        val first = unlocker.awaitForm()

        unlocker.request("f", "Taxes")
        assertEquals(first, unlocker.prompt.value)
        unlocker.request("g")

        assertEquals("g", unlocker.awaitForm().folderId)
        assertEquals(2, world.requests.count { it == "GET vault/status" })
    }

    @Test fun `the right secret closes the prompt and retries what was refused`() = run {
        unlocker.request("f")
        unlocker.awaitForm()

        unlocker.submit("4821")
        unlocker.prompt.first { it == null }

        assertEquals(listOf("f"), opened)
        assertEquals("""POST vault/unlock {"password":"4821","folder_id":"f"}""", world.requests.last())
    }

    @Test fun `a wrong try is one request, shows the tries left and asks for a new entry`() = run {
        refuse("pin", 7)
        unlocker.request("f")
        val before = unlocker.awaitForm()

        unlocker.submit("0000")
        val after = answered()

        assertEquals("Incorrect PIN. 7 tries left.", after.error)
        assertEquals(LockAsk.PIN, asked(after))
        assertEquals(before.entry + 1, after.entry)
        assertEquals(1, tries())
        assertEquals(emptyList<String>(), opened)
    }

    @Test fun `the last wrong try turns to the account password, and a wrong one of those is explained`() = run {
        refuse("account_password", null)
        refuse("account_password", null)
        unlocker.request("f")
        unlocker.awaitForm()

        unlocker.submit("0000")
        val stopped = answered()
        assertEquals(LockAsk.ACCOUNT_PASSWORD, asked(stopped))
        assertNull(stopped.error)
        unlocker.submit("wrong")

        assertEquals("Incorrect password. Try again.", answered().error)
    }

    @Test fun `a refusal that names another secret switches what is asked`() = run {
        refuse("password", 9)
        unlocker.request("f")
        unlocker.awaitForm()

        unlocker.submit("4821")
        val after = answered()

        assertEquals(LockAsk.PASSWORD, asked(after))
        assertEquals("Incorrect password. 9 tries left.", after.error)
    }

    @Test fun `a try that got no answer keeps a typed password, and asks for the PIN again`() = run {
        unlocker.request("f")
        val pin = unlocker.awaitForm()
        world.isOffline = true
        unlocker.submit("4821")
        assertEquals(pin.entry + 1, answered().entry)

        world.isOffline = false
        world.secretKind = LockSecretKind.PASSWORD
        unlocker.dismiss()
        unlocker.request("f")
        val password = unlocker.awaitForm()
        world.isOffline = true
        unlocker.submit("open sesame")

        assertEquals(password.entry, answered().entry)
    }

    @Test fun `a late refusal does not bring a dismissed prompt back`() = run {
        refuse("password", 7)
        unlocker.request("f")
        unlocker.awaitForm()
        val gate = CompletableDeferred<Unit>()
        world.vaultGate = gate
        unlocker.submit("0000")
        world.awaitRequests("""POST vault/unlock {"password":"0000","folder_id":"f"}""", 1)

        unlocker.dismiss()
        gate.complete(Unit)
        // The refusal is in once the repository has heard what it says; the prompt hears it straight after.
        world.vault.status.first { it?.ask == LockAsk.PASSWORD }
        delay(50)

        assertNull(unlocker.prompt.value)
    }

    @Test fun `a late success still retries what was refused`() = run {
        unlocker.request("f")
        unlocker.awaitForm()
        val gate = CompletableDeferred<Unit>()
        world.vaultGate = gate
        unlocker.submit("4821")

        unlocker.dismiss()
        gate.complete(Unit)
        while (opened.isEmpty()) delay(5)

        assertEquals(listOf("f"), opened)
        assertNull(unlocker.prompt.value)
    }
}
