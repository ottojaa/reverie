package com.reverie.app.di

import com.reverie.app.data.local.DiskPrivateDataPurger
import com.reverie.app.data.local.PrivateDataPurger
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class PrivacyModule {
    @Binds
    abstract fun bindPrivateDataPurger(impl: DiskPrivateDataPurger): PrivateDataPurger
}
