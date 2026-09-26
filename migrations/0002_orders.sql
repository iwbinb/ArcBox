/* M2-B additive shared order pipeline. No seed deployments, signers or funds. */
CREATE TABLE order_deployments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 chain_id INTEGER NOT NULL CHECK(chain_id=5042002), address TEXT NOT NULL,
 asset TEXT NOT NULL, beneficiary TEXT NOT NULL, adapter TEXT NOT NULL CHECK(adapter='m2b-probe-v1'),
 code_hash TEXT NOT NULL, deployment_block INTEGER NOT NULL CHECK(deployment_block>=0),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','HALTED')),
 created_at INTEGER NOT NULL, UNIQUE(chain_id,address)
);
-- break --
CREATE TABLE order_rules (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 deployment_id TEXT NOT NULL REFERENCES order_deployments(id), draft_id TEXT NOT NULL REFERENCES drafts(id),
 draft_version INTEGER NOT NULL, rules_hash TEXT NOT NULL, canonical_json TEXT NOT NULL,
 amount_u6 TEXT NOT NULL CHECK(typeof(amount_u6)='text' AND length(amount_u6) BETWEEN 1 AND 78 AND amount_u6 NOT GLOB '*[^0-9]*' AND substr(amount_u6,1,1)!='0'),
 title TEXT NOT NULL, tool_type TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 UNIQUE(deployment_id,draft_id,draft_version)
);
-- break --
CREATE TABLE orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 rule_id TEXT NOT NULL REFERENCES order_rules(id), deployment_id TEXT NOT NULL REFERENCES order_deployments(id),
 chain_order_id TEXT NOT NULL UNIQUE, payer TEXT NOT NULL, amount_u6 TEXT NOT NULL,
 nonce TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 payment_state TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_state IN ('UNPAID','CONFIRMED')),
 funds_state TEXT NOT NULL DEFAULT 'NONE' CHECK(funds_state IN ('NONE','LOCKED','REFUND_CREDIT','SETTLEMENT_CREDIT','REFUNDED','SETTLED')),
 delivery_state TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(delivery_state IN ('NOT_STARTED','AVAILABLE','REVOKED')),
 business_state TEXT NOT NULL DEFAULT 'CREATED' CHECK(business_state IN ('CREATED','ACTIVE','CANCELLED','COMPLETED')),
 applied_sequence INTEGER NOT NULL DEFAULT 0 CHECK(applied_sequence BETWEEN 0 AND 64),
 version INTEGER NOT NULL DEFAULT 1, last_block INTEGER
);
-- break --
CREATE INDEX orders_payer ON orders(payer,id);
-- break --
CREATE INDEX orders_workspace ON orders(workspace_id,id);
-- break --
CREATE TABLE order_idempotency (
 key_hash TEXT PRIMARY KEY, request_hash TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), created_at INTEGER NOT NULL
);
-- break --
CREATE TABLE transaction_attempts (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), tx_hash TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('approval','payment','business')),
 status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PENDING','CONFIRMED','REVERTED','REJECTED','REPLACED')),
 sender TEXT, tx_nonce INTEGER, last_error TEXT, checks INTEGER NOT NULL DEFAULT 0,
 next_check_at INTEGER NOT NULL, created_at INTEGER NOT NULL, checked_at INTEGER,
 UNIQUE(order_id,tx_hash,purpose)
);
-- break --
CREATE INDEX attempts_due ON transaction_attempts(status,next_check_at,id);
-- break --
CREATE TABLE order_chain_events (
 event_key TEXT PRIMARY KEY, deployment_id TEXT NOT NULL REFERENCES order_deployments(id),
 chain_order_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 64),
 fingerprint TEXT NOT NULL, event_json TEXT NOT NULL, block_number INTEGER NOT NULL,
 transaction_index INTEGER NOT NULL, log_index INTEGER NOT NULL, verified_at INTEGER NOT NULL,
 UNIQUE(deployment_id,chain_order_id,sequence)
);
-- break --
CREATE TABLE order_event_outcomes (
 event_key TEXT PRIMARY KEY REFERENCES order_chain_events(event_key),
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','QUARANTINED')),
 reason TEXT, applied_at INTEGER
);
-- break --
CREATE INDEX order_events_sequence ON order_chain_events(chain_order_id,sequence);
-- break --
CREATE TABLE order_ledger (
 event_key TEXT NOT NULL REFERENCES order_chain_events(event_key), entry_index INTEGER NOT NULL,
 order_id TEXT NOT NULL REFERENCES orders(id), account TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('DEBIT','CREDIT')), amount_u6 TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(event_key,entry_index)
);
-- break --
CREATE INDEX ledger_order ON order_ledger(order_id,event_key,entry_index);
-- break --
CREATE TABLE order_outbox (
 id TEXT PRIMARY KEY, effect_key TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id),
 type TEXT NOT NULL CHECK(type IN ('VERIFY_RECEIPT','ORDER_PROJECTED')), payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENT')),
 created_at INTEGER NOT NULL, sent_at INTEGER
);
-- break --
CREATE INDEX order_outbox_pending ON order_outbox(state,created_at,id);
-- break --
CREATE TABLE order_sync_cursors (
 deployment_id TEXT PRIMARY KEY REFERENCES order_deployments(id),
 last_complete_block INTEGER NOT NULL, last_block_hash TEXT,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 last_checked_at INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
-- break --
CREATE TABLE order_sync_incidents (
 id INTEGER PRIMARY KEY AUTOINCREMENT, deployment_id TEXT NOT NULL REFERENCES order_deployments(id),
 event_key TEXT, code TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(deployment_id,event_key,code)
);
-- break --
CREATE TABLE order_mutation_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
-- break --
CREATE TRIGGER order_rule_immutable BEFORE UPDATE ON order_rules BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_RULE'); END;
-- break --
CREATE TRIGGER order_rule_no_delete BEFORE DELETE ON order_rules BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_RULE'); END;
-- break --
CREATE TRIGGER order_snapshot_immutable BEFORE UPDATE ON orders WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.rule_id!=OLD.rule_id OR NEW.deployment_id!=OLD.deployment_id OR NEW.chain_order_id!=OLD.chain_order_id OR NEW.payer!=OLD.payer OR NEW.amount_u6!=OLD.amount_u6 OR NEW.nonce!=OLD.nonce OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER'); END;
-- break --
CREATE TRIGGER order_deployment_immutable BEFORE UPDATE ON order_deployments WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.chain_id!=OLD.chain_id OR NEW.address!=OLD.address OR NEW.asset!=OLD.asset OR NEW.beneficiary!=OLD.beneficiary OR NEW.adapter!=OLD.adapter OR NEW.code_hash!=OLD.code_hash OR NEW.deployment_block!=OLD.deployment_block BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DEPLOYMENT'); END;
-- break --
CREATE TRIGGER order_event_immutable BEFORE UPDATE ON order_chain_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_EVENT'); END;
-- break --
CREATE TRIGGER order_event_no_delete BEFORE DELETE ON order_chain_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_EVENT'); END;
-- break --
CREATE TRIGGER order_ledger_immutable BEFORE UPDATE ON order_ledger BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_LEDGER'); END;
-- break --
CREATE TRIGGER order_ledger_no_delete BEFORE DELETE ON order_ledger BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_LEDGER'); END;
-- break --
CREATE TRIGGER order_outbox_payload_immutable BEFORE UPDATE ON order_outbox WHEN NEW.effect_key!=OLD.effect_key OR NEW.order_id!=OLD.order_id OR NEW.type!=OLD.type OR NEW.payload_json!=OLD.payload_json BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OUTBOX_PAYLOAD'); END;
-- break --
CREATE TRIGGER order_created_audit AFTER INSERT ON orders BEGIN
 INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at)
 SELECT NEW.workspace_id,id,'order.created',NEW.id,1,NEW.created_at FROM users WHERE address=NEW.payer AND chain_id=5042002;
END;
-- break --
CREATE TRIGGER rule_created_audit AFTER INSERT ON order_rules BEGIN
 INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at) VALUES(NEW.workspace_id,NEW.created_by,'order-rule.frozen',NEW.id,NEW.draft_version,NEW.created_at);
END;
