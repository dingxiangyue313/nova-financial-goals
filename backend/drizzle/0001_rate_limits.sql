CREATE TABLE nova_rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_nova_rate_limits_key_window ON nova_rate_limits(key, window_start);
CREATE INDEX idx_nova_rate_limits_window ON nova_rate_limits(window_start);
