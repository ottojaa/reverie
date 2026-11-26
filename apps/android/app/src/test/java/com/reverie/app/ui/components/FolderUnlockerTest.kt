package com.reverie.app.ui.components

import com.reverie.app.data.repository.UnlockOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FolderUnlockerTest {

    @Test fun `an opened lock shows no error`() {
        assertNull(UnlockOutcome.Unlocked.toPromptError())
        assertNull(UnlockOutcome.NotPrivate.toPromptError())
    }

    @Test fun `a wrong password is explained`() {
        assertEquals("Incorrect password.", UnlockOutcome.WrongPassword.toPromptError())
    }

    @Test fun `an account without a password points at the web app`() {
        val message = UnlockOutcome.NoPassword.toPromptError()
        assertEquals("Your account has no password yet.", message)
    }

    @Test fun `a failure shows its own message`() {
        assertEquals("Offline", UnlockOutcome.Failed("Offline").toPromptError())
    }
}
