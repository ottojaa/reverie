# Add project specific ProGuard rules here.

# Keep Kotlin metadata
-keep class kotlin.Metadata { *; }

# Ktor
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
-dontwarn org.slf4j.**

# OkHttp / okio
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# ---- kotlinx.serialization ----
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
# Keep generated serializers and their companions for our models.
-keepclassmembers class com.reverie.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.reverie.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.reverie.app.**$$serializer { *; }
# Belt-and-braces: keep the wire DTOs intact for reflection-free serialization.
-keep class com.reverie.app.data.api.model.** { *; }

# ---- Socket.IO / engine.io ----
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# ML Kit document scanner (GMS)
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
