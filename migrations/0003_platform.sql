/* M2-C: additive local platform. No seed accounts, cloud IDs, or funds. */
CREATE TABLE file_versions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 series_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 catalog_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime='text/plain'),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 65536), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 storage_key TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'UPLOADING' CHECK(state IN ('UPLOADING','QUARANTINED','READY','REJECTED')),
 upload_until INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 UNIQUE(workspace_id,series_id,version)
);
-- break --
CREATE INDEX files_workspace ON file_versions(workspace_id,id);
-- break --
CREATE TABLE file_rule_bindings (
 rule_id TEXT PRIMARY KEY REFERENCES order_rules(id), file_id TEXT NOT NULL REFERENCES file_versions(id),
 retention_ms INTEGER NOT NULL CHECK(retention_ms=2592000000)
);
-- break --
CREATE TABLE file_entitlements (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), file_id TEXT NOT NULL REFERENCES file_versions(id),
 wallet TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ACTIVE','REVOKED')),
 retention_until INTEGER NOT NULL, source_event TEXT NOT NULL REFERENCES order_chain_events(event_key), created_at INTEGER NOT NULL
);
-- break --
CREATE TABLE download_grants (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 order_id TEXT NOT NULL REFERENCES file_entitlements(order_id), session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
);
-- break --
CREATE INDEX grants_expiry ON download_grants(expires_at);
-- break --
CREATE TABLE platform_jobs (
 id TEXT PRIMARY KEY, effect_key TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 type TEXT NOT NULL CHECK(type IN ('VERIFY_FILE','VERIFY_RECEIPT','ORDER_PROJECTED')), source_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','QUEUED','RUNNING','RETRY','SUCCEEDED','DEAD')),
 generation INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, dispatch_attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- break --
CREATE INDEX jobs_due ON platform_jobs(state,available_at,lease_until,id);
-- break --
CREATE INDEX jobs_workspace ON platform_jobs(workspace_id,id);
-- break --
CREATE TABLE platform_inbox (job_id TEXT PRIMARY KEY REFERENCES platform_jobs(id), result_code TEXT NOT NULL, completed_at INTEGER NOT NULL);
-- break --
CREATE TABLE platform_notifications (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES platform_jobs(id), user_id TEXT NOT NULL REFERENCES users(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), order_id TEXT NOT NULL REFERENCES orders(id),
 code TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER, UNIQUE(job_id,user_id)
);
-- break --
CREATE INDEX notifications_user ON platform_notifications(user_id,id);
-- break --
CREATE TABLE platform_activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL, code TEXT, created_at INTEGER NOT NULL
);
-- break --
CREATE INDEX activity_workspace ON platform_activity(workspace_id,id);
-- break --
CREATE TRIGGER file_identity_immutable BEFORE UPDATE ON file_versions
 WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.series_id!=OLD.series_id OR NEW.version!=OLD.version OR NEW.catalog_id!=OLD.catalog_id OR NEW.name!=OLD.name OR NEW.mime!=OLD.mime OR NEW.bytes!=OLD.bytes OR NEW.sha256!=OLD.sha256 OR NEW.storage_key!=OLD.storage_key OR NEW.key_hash!=OLD.key_hash OR NEW.request_hash!=OLD.request_hash OR NEW.upload_until!=OLD.upload_until OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FILE_VERSION'); END;
-- break --
CREATE TRIGGER file_state_guard BEFORE UPDATE ON file_versions
 WHEN NEW.state!=OLD.state AND NOT ((OLD.state='UPLOADING' AND NEW.state='QUARANTINED') OR (OLD.state='QUARANTINED' AND NEW.state IN ('READY','REJECTED')) OR (OLD.state='READY' AND NEW.state='REJECTED'))
 BEGIN SELECT RAISE(ABORT,'INVALID_FILE_TRANSITION'); END;
-- break --
CREATE TRIGGER file_no_delete BEFORE DELETE ON file_versions BEGIN SELECT RAISE(ABORT,'RETAIN_FILE_VERSION'); END;
-- break --
CREATE TRIGGER file_binding_guard BEFORE INSERT ON file_rule_bindings BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM order_rules r JOIN file_versions f ON f.id=NEW.file_id WHERE r.id=NEW.rule_id AND r.workspace_id=f.workspace_id AND f.state='READY' AND json_extract(r.canonical_json,'$.schema')='arcbox.order-rule.file.v1' AND json_extract(r.canonical_json,'$.file.id')=f.id AND json_extract(r.canonical_json,'$.file.sha256')=f.sha256 AND json_extract(r.canonical_json,'$.file.retentionMs')=NEW.retention_ms) THEN RAISE(ABORT,'INVALID_FILE_BINDING') END;
END;
-- break --
CREATE TRIGGER file_binding_no_update BEFORE UPDATE ON file_rule_bindings BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FILE_BINDING'); END;
-- break --
CREATE TRIGGER file_binding_no_delete BEFORE DELETE ON file_rule_bindings BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FILE_BINDING'); END;
-- break --
CREATE TRIGGER entitlement_immutable BEFORE UPDATE ON file_entitlements WHEN NEW.order_id!=OLD.order_id OR NEW.file_id!=OLD.file_id OR NEW.wallet!=OLD.wallet OR NEW.retention_until!=OLD.retention_until OR NEW.source_event!=OLD.source_event OR NEW.created_at!=OLD.created_at OR (OLD.state='REVOKED' AND NEW.state!='REVOKED') BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTITLEMENT'); END;
-- break --
CREATE TRIGGER entitlement_no_delete BEFORE DELETE ON file_entitlements BEGIN SELECT RAISE(ABORT,'RETAIN_ENTITLEMENT'); END;
-- break --
CREATE TRIGGER grant_immutable BEFORE UPDATE ON download_grants WHEN NEW.id!=OLD.id OR NEW.token_hash!=OLD.token_hash OR NEW.order_id!=OLD.order_id OR NEW.session_hash!=OLD.session_hash OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DOWNLOAD_GRANT'); END;
-- break --
CREATE TRIGGER job_identity_immutable BEFORE UPDATE ON platform_jobs WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.effect_key!=OLD.effect_key OR NEW.type!=OLD.type OR NEW.source_id!=OLD.source_id OR NEW.created_at!=OLD.created_at BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOB'); END;
-- break --
CREATE TRIGGER inbox_no_update BEFORE UPDATE ON platform_inbox BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_INBOX'); END;
-- break --
CREATE TRIGGER inbox_no_delete BEFORE DELETE ON platform_inbox BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_INBOX'); END;
-- break --
CREATE TRIGGER notification_immutable BEFORE UPDATE ON platform_notifications WHEN NEW.id!=OLD.id OR NEW.job_id!=OLD.job_id OR NEW.user_id!=OLD.user_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.order_id!=OLD.order_id OR NEW.code!=OLD.code OR NEW.created_at!=OLD.created_at BEGIN SELECT RAISE(ABORT,'IMMUTABLE_NOTIFICATION'); END;
-- break --
CREATE TRIGGER platform_activity_no_update BEFORE UPDATE ON platform_activity BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_ACTIVITY'); END;
-- break --
CREATE TRIGGER platform_activity_no_delete BEFORE DELETE ON platform_activity BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_ACTIVITY'); END;
