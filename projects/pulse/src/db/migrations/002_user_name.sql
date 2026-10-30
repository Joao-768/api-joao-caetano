-- Accounts carry a display name. Rows created before this migration get an
-- empty one, which the client shows as the email instead.

ALTER TABLE users
    ADD COLUMN name TEXT NOT NULL DEFAULT ''
    CONSTRAINT users_name_length CHECK (char_length(name) <= 80);
