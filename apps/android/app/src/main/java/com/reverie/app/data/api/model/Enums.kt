package com.reverie.app.data.api.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Serializer for a string-backed enum that tolerates values the server may add later,
 * decoding anything unrecognised to [default] instead of throwing. Used for enums that are
 * expected to grow (document categories, entity types).
 */
open class EnumWireSerializer<T : Enum<T>>(
    name: String,
    private val entries: Array<T>,
    private val wireOf: (T) -> String,
    private val default: T,
) : KSerializer<T> {
    override val descriptor = PrimitiveSerialDescriptor(name, PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: T) = encoder.encodeString(wireOf(value))
    override fun deserialize(decoder: Decoder): T {
        val raw = decoder.decodeString()
        return entries.firstOrNull { wireOf(it) == raw } ?: default
    }
}

@Serializable(with = DocumentCategory.Serializer::class)
enum class DocumentCategory(val wire: String) {
    PHOTO("photo"),
    SCREENSHOT("screenshot"),
    GRAPHIC("graphic"),
    VIDEO("video"),
    RECEIPT("receipt"),
    INVOICE("invoice"),
    LETTER("letter"),
    CONTRACT("contract"),
    FORM("form"),
    CERTIFICATE("certificate"),
    REPORT("report"),
    ARTICLE("article"),
    MEMO("memo"),
    NEWSLETTER("newsletter"),
    STOCK_STATEMENT("stock_statement"),
    BANK_STATEMENT("bank_statement"),
    MEDICAL_RECORD("medical_record"),
    BILL_OF_MATERIALS("bill_of_materials"),
    OTHER("other");

    object Serializer : EnumWireSerializer<DocumentCategory>(
        "DocumentCategory", entries.toTypedArray(), { it.wire }, OTHER,
    )

    companion object {
        val NON_TEXT = setOf(PHOTO, SCREENSHOT, GRAPHIC, VIDEO)
        fun fromWire(wire: String?): DocumentCategory? = entries.firstOrNull { it.wire == wire }
    }
}

@Serializable(with = EntityType.Serializer::class)
enum class EntityType(val wire: String) {
    PERSON("person"),
    ORGANIZATION("organization"),
    LOCATION("location"),
    PRODUCT("product"),
    ACCOUNT("account"),
    IDENTIFIER("identifier"),
    CONTACT("contact"),
    OTHER("other");

    object Serializer : EnumWireSerializer<EntityType>(
        "EntityType", entries.toTypedArray(), { it.wire }, OTHER,
    )
}

@Serializable
enum class JobStatus {
    @SerialName("pending") PENDING,
    @SerialName("processing") PROCESSING,
    @SerialName("complete") COMPLETE,
    @SerialName("failed") FAILED,
    @SerialName("skipped") SKIPPED;

    val isTerminal: Boolean get() = this == COMPLETE || this == FAILED || this == SKIPPED
}

@Serializable
enum class JobType {
    @SerialName("ocr") OCR,
    @SerialName("thumbnail") THUMBNAIL,
    @SerialName("llm_summary") LLM_SUMMARY,
    @SerialName("video_trim") VIDEO_TRIM,
}

@Serializable
enum class TargetType {
    @SerialName("document") DOCUMENT,
    @SerialName("folder") FOLDER,
}

@Serializable
enum class FolderType {
    @SerialName("collection") COLLECTION,
    @SerialName("folder") FOLDER,
}

@Serializable
enum class UserRole {
    @SerialName("admin") ADMIN,
    @SerialName("user") USER,
}

@Serializable
enum class SortBy(val wire: String) {
    @SerialName("relevance") RELEVANCE("relevance"),
    @SerialName("uploaded") UPLOADED("uploaded"),
    @SerialName("date") DATE("date"),
    @SerialName("filename") FILENAME("filename"),
    @SerialName("size") SIZE("size"),
}

@Serializable
enum class SortOrder(val wire: String) {
    @SerialName("asc") ASC("asc"),
    @SerialName("desc") DESC("desc"),
}

@Serializable
enum class SuggestionType(val wire: String) {
    @SerialName("filename") FILENAME("filename"),
    @SerialName("folder") FOLDER("folder"),
    @SerialName("tag") TAG("tag"),
    @SerialName("entity") ENTITY("entity"),
    @SerialName("category") CATEGORY("category"),
    @SerialName("location") LOCATION("location"),
}

@Serializable
enum class ConflictStrategy(val wire: String) {
    @SerialName("replace") REPLACE("replace"),
    @SerialName("keep_both") KEEP_BOTH("keep_both"),
}
