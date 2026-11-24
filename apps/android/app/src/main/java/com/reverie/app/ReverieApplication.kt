package com.reverie.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.di.ApplicationScope
import com.reverie.app.domain.model.AuthState
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class ReverieApplication : Application(), ImageLoaderFactory, Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var authSessionManager: AuthSessionManager
    @Inject lateinit var privateDataPurger: PrivateDataPurger
    @Inject lateinit var folderRepository: FolderRepository
    @Inject @field:ApplicationScope lateinit var appScope: CoroutineScope

    override fun onCreate() {
        super.onCreate()
        purgePrivateDataOnLogout()
    }

    /**
     * Whatever way the session ends (explicit logout or a failed token refresh), the folder locks
     * close with it, so private documents held in memory and their transient files must go too.
     */
    private fun purgePrivateDataOnLogout() {
        appScope.launch {
            authSessionManager.authState
                .filter { it is AuthState.LoggedOut }
                .collect {
                    privateDataPurger.clearSession()
                    folderRepository.clearCovers()
                }
        }
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    /**
     * Coil resolves this lazily on the first image load — well after Hilt has built the
     * graph — so an EntryPoint is the reliable way to hand it the DI-provided [ImageLoader].
     */
    override fun newImageLoader(): ImageLoader =
        EntryPointAccessors.fromApplication(this, ImageLoaderEntryPoint::class.java).imageLoader()

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface ImageLoaderEntryPoint {
        fun imageLoader(): ImageLoader
    }
}
