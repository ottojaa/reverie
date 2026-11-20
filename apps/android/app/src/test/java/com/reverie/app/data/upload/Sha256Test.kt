package com.reverie.app.data.upload

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.MessageDigest

/** The hash must equal what the server stores as `documents.file_hash` (hex SHA-256 of the raw bytes). */
class Sha256Test {
    private fun reference(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test
    fun `matches the known test vector for abc`() =
        runTest {
            assertEquals(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                ByteArrayInputStream("abc".toByteArray()).sha256Hex(),
            )
        }

    @Test
    fun `hashes an empty stream`() =
        runTest {
            assertEquals(
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                ByteArrayInputStream(ByteArray(0)).sha256Hex(),
            )
        }

    @Test
    fun `hashes a stream far larger than its read buffer`() =
        runTest {
            val bytes = ByteArray(5 * 64 * 1024 + 123) { (it * 31).toByte() }
            assertEquals(reference(bytes), ByteArrayInputStream(bytes).sha256Hex())
        }

    @Test
    fun `reads in blocks and reports a running byte total`() =
        runTest {
            val bytes = ByteArray(200_000) { it.toByte() }
            val reads = mutableListOf<Int>()
            val stream =
                object : InputStream() {
                    private val inner = ByteArrayInputStream(bytes)

                    override fun read(): Int = inner.read()

                    override fun read(
                        b: ByteArray,
                        off: Int,
                        len: Int,
                    ): Int = inner.read(b, off, len).also { if (it > 0) reads += it }
                }
            val totals = mutableListOf<Long>()

            stream.sha256Hex { totals += it }

            assertTrue("no single read may be the whole file", reads.max() <= 64 * 1024)
            assertEquals(bytes.size.toLong(), totals.last())
            assertEquals(totals.sorted(), totals)
        }

    @Test
    fun `stops when the coroutine is cancelled`() {
        val scope = CoroutineScope(Dispatchers.Unconfined)
        val endless =
            object : InputStream() {
                override fun read(): Int = 1

                override fun read(
                    b: ByteArray,
                    off: Int,
                    len: Int,
                ): Int = len
            }
        var failure: Throwable? = null
        val job =
            scope.launch {
                try {
                    endless.sha256Hex { total -> if (total > 1_000_000) scope.cancel() }
                } catch (e: CancellationException) {
                    failure = e
                    throw e
                }
            }

        assertTrue("the hash loop must end instead of reading forever", job.isCompleted)
        assertNotNull("hashing should have been cancelled", failure)
    }
}
