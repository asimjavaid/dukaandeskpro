-- Lite: the installer's DD_INSTALL_MODE last applied (so an owner's later change in Tills survives restarts).
ALTER TABLE store ADD COLUMN IF NOT EXISTS install_mode_env TEXT;
