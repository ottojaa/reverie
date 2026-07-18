plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.reverie.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.reverie.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Emulator loopback to a backend on the host machine (`10.0.2.2` == host `localhost`).
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:3000\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Prod URL comes from a gradle property so it never lands in source control.
            val prodUrl = providers.gradleProperty("REVERIE_PROD_URL").getOrElse("https://reverie.example.com")
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"$prodUrl\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // AGP 8.7's bundled lint crashes in these detectors under JDK 21+
        // (IncompatibleClassChangeError). They flag nothing we rely on.
        disable += "NullSafeMutableLiveData"
        disable += "FrequentlyChangingValue"
        disable += "RememberInComposition"
    }
}

dependencies {
    // Core Android
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    debugImplementation(libs.androidx.ui.tooling)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.ext.compiler)

    // Background work + upload
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.exifinterface)
    implementation(libs.mlkit.document.scanner)

    // Networking — Ktor on the OkHttp engine (shared with Coil + socket.io)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.client.auth)
    implementation(libs.ktor.client.logging)
    implementation(libs.ktor.serialization.kotlinx.json)

    // Serialization + coroutines
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // Local storage
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // Shared OkHttp runtime (Coil authed thumbnails)
    implementation(platform(libs.okhttp.bom))
    implementation(libs.okhttp)

    // Image loading
    implementation(libs.coil.compose)
    implementation(libs.zoomable.image.coil)

    // Lucide icons (vector drawables) — folder/collection section icons, resolved by name at runtime
    implementation(libs.icons.lucide.android)

    // Realtime + lifecycle
    // Exclude the bundled org.json — Android ships its own, which collides at packaging time.
    implementation(libs.socketio.client) {
        exclude(group = "org.json", module = "json")
    }
    implementation(libs.androidx.lifecycle.process)

    // Media / viewers
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.ui)
    implementation(libs.androidx.media3.datasource.okhttp)

    // Unit testing
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.ktor.client.mock)
}
