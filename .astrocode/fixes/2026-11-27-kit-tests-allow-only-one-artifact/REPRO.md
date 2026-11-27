# Reproduction

`node --test tests/kit_email_attachments.test.mjs`: a kit with two produced artifacts both tagged `email_attachment` failed M-02 ("only one permitted") and R-12 ("at most ONE may") before the change; it passes after.
