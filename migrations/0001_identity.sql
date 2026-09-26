/* M2-A additive identity schema. No payment tables, funds or seed users. */
CREATE TABLE users (id TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id=5042002), created_at INTEGER NOT NULL, UNIQUE(chain_id,address));
-- break --
CREATE TABLE auth_challenges (nonce_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, address TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, session_until INTEGER NOT NULL);
-- break --
CREATE INDEX challenges_expiry ON auth_challenges(expires_at);
-- break --
CREATE TABLE auth_grants (nonce_hash TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
-- break --
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, signer_kind TEXT NOT NULL CHECK(signer_kind IN ('eoa','erc1271')), signed_message TEXT, signature TEXT);
-- break --
CREATE INDEX sessions_user ON sessions(user_id,expires_at);
-- break --
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
-- break --
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), owner_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id));
-- break --
CREATE TABLE memberships (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','editor','operator','viewer')), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(workspace_id,user_id));
-- break --
CREATE INDEX membership_user ON memberships(user_id,workspace_id);
-- break --
CREATE TABLE invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), recipient TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('editor','operator','viewer')), state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','revoked','expired')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), accepted_by TEXT REFERENCES users(id));
-- break --
CREATE UNIQUE INDEX one_pending_invitation ON invitations(workspace_id,recipient) WHERE state='pending';
-- break --
CREATE INDEX invitations_recipient ON invitations(recipient,state,expires_at);
-- break --
CREATE TABLE drafts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), tool_type TEXT NOT NULL CHECK(tool_type IN ('deliver','group','split','attend','milestones','rewards')), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80), description TEXT NOT NULL CHECK(length(description)<=2000), version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id));
-- break --
CREATE INDEX drafts_workspace ON drafts(workspace_id,archived,id);
-- break --
CREATE TABLE draft_revisions (draft_id TEXT NOT NULL REFERENCES drafts(id), version INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, archived INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY(draft_id,version));
-- break --
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT REFERENCES workspaces(id), actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER, created_at INTEGER NOT NULL);
-- break --
CREATE INDEX audit_workspace ON audit_logs(workspace_id,id);
-- break --
CREATE TRIGGER workspace_created AFTER INSERT ON workspaces BEGIN
 INSERT INTO memberships(workspace_id,user_id,role,updated_at,updated_by) VALUES(NEW.id,NEW.owner_id,'owner',NEW.created_at,NEW.owner_id);
 INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at) VALUES(NEW.id,NEW.owner_id,'workspace.created',NEW.id,1,NEW.created_at);
END;
-- break --
CREATE TRIGGER workspace_immutable BEFORE UPDATE ON workspaces WHEN NEW.owner_id!=OLD.owner_id OR NEW.id!=OLD.id OR NEW.version!=OLD.version+1 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKSPACE'); END;
-- break --
CREATE TRIGGER workspace_updated AFTER UPDATE ON workspaces BEGIN INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at) VALUES(NEW.id,NEW.updated_by,'workspace.updated',NEW.id,NEW.version,NEW.updated_at); END;
-- break --
CREATE TRIGGER owner_membership_immutable BEFORE UPDATE ON memberships WHEN OLD.role='owner' OR NEW.role='owner' OR NEW.user_id!=OLD.user_id OR NEW.workspace_id!=OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER'); END;
-- break --
CREATE TRIGGER owner_membership_delete BEFORE DELETE ON memberships WHEN OLD.role='owner' BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER'); END;
-- break --
CREATE TRIGGER member_updated AFTER UPDATE ON memberships BEGIN INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,created_at) VALUES(NEW.workspace_id,NEW.updated_by,'member.updated',NEW.user_id,NEW.updated_at); END;
-- break --
CREATE TRIGGER invitation_created AFTER INSERT ON invitations BEGIN INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,created_at) VALUES(NEW.workspace_id,NEW.updated_by,'invitation.created',NEW.id,NEW.created_at); END;
-- break --
CREATE TRIGGER invitation_updated AFTER UPDATE ON invitations BEGIN INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,created_at) VALUES(NEW.workspace_id,NEW.updated_by,'invitation.'||NEW.state,NEW.id,NEW.updated_at); END;
-- break --
CREATE TRIGGER invitation_accept_guard BEFORE UPDATE ON invitations WHEN NEW.state='accepted' AND (OLD.state!='pending' OR NEW.accepted_by IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.accepted_by AND address=NEW.recipient)) BEGIN SELECT RAISE(ABORT,'INVALID_INVITATION_ACCEPT'); END;
-- break --
CREATE TRIGGER invitation_accepted AFTER UPDATE ON invitations WHEN OLD.state='pending' AND NEW.state='accepted' BEGIN INSERT INTO memberships(workspace_id,user_id,role,updated_at,updated_by) VALUES(NEW.workspace_id,NEW.accepted_by,NEW.role,NEW.updated_at,NEW.accepted_by); END;
-- break --
CREATE TRIGGER draft_created AFTER INSERT ON drafts BEGIN
 INSERT INTO draft_revisions(draft_id,version,title,description,archived,actor_id,created_at) VALUES(NEW.id,NEW.version,NEW.title,NEW.description,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at) VALUES(NEW.workspace_id,NEW.updated_by,'draft.created',NEW.id,NEW.version,NEW.updated_at);
END;
-- break --
CREATE TRIGGER draft_version_guard BEFORE UPDATE ON drafts WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.tool_type!=OLD.tool_type OR NEW.version!=OLD.version+1 OR OLD.archived=1 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DRAFT'); END;
-- break --
CREATE TRIGGER draft_updated AFTER UPDATE ON drafts BEGIN
 INSERT INTO draft_revisions(draft_id,version,title,description,archived,actor_id,created_at) VALUES(NEW.id,NEW.version,NEW.title,NEW.description,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,version,created_at) VALUES(NEW.workspace_id,NEW.updated_by,CASE WHEN NEW.archived=1 THEN 'draft.archived' ELSE 'draft.updated' END,NEW.id,NEW.version,NEW.updated_at);
END;
-- break --
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END;
-- break --
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END;
-- break --
CREATE TRIGGER revision_no_update BEFORE UPDATE ON draft_revisions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_REVISION'); END;
-- break --
CREATE TRIGGER revision_no_delete BEFORE DELETE ON draft_revisions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_REVISION'); END;
