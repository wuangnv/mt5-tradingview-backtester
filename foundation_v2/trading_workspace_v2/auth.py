from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from threading import RLock


LOCAL_AUTH_MODE = "local-trusted-identity"


class MissingTrustedIdentity(RuntimeError):
    pass


class WorkspaceMembershipDenied(PermissionError):
    pass


@dataclass(frozen=True)
class TrustedIdentity:
    subject: str
    source: str = "local-process"


@dataclass(frozen=True)
class WorkspaceAuthorizationContext:
    identity: TrustedIdentity
    workspace_id: str


class LocalTrustedIdentityAdapter:
    """Local-only identity supplied by trusted server configuration, never request headers."""

    def __init__(self, subject: str | None):
        normalized = subject.strip() if subject else ""
        self._identity = TrustedIdentity(normalized) if normalized else None

    @property
    def configured(self) -> bool:
        return self._identity is not None

    def resolve(self) -> TrustedIdentity:
        if self._identity is None:
            raise MissingTrustedIdentity("trusted local identity is not configured")
        return self._identity


class ServerWorkspaceMemberships:
    """Server-owned allowlist for workspace membership in local-only mode."""

    def __init__(self, memberships: Mapping[str, Iterable[str]] | None = None):
        self._lock = RLock()
        self._memberships: dict[str, set[str]] = {}
        for subject, workspace_ids in (memberships or {}).items():
            normalized_subject = subject.strip()
            if not normalized_subject:
                continue
            self._memberships[normalized_subject] = {
                workspace_id.strip() for workspace_id in workspace_ids if workspace_id and workspace_id.strip()
            }

    def is_member(self, subject: str, workspace_id: str) -> bool:
        with self._lock:
            return workspace_id in self._memberships.get(subject, set())

    def grant(self, subject: str, workspace_id: str) -> None:
        normalized_subject = subject.strip()
        normalized_workspace = workspace_id.strip()
        if not normalized_subject or not normalized_workspace:
            raise ValueError("subject and workspace_id are required")
        with self._lock:
            self._memberships.setdefault(normalized_subject, set()).add(normalized_workspace)

    def revoke(self, subject: str, workspace_id: str) -> None:
        with self._lock:
            allowed = self._memberships.get(subject)
            if allowed is not None:
                allowed.discard(workspace_id)


class LocalWorkspaceAuthorization:
    """Explicit local-only auth boundary; not OAuth, IdP authentication, DB RLS, or production auth."""

    def __init__(self, identity: LocalTrustedIdentityAdapter, memberships: ServerWorkspaceMemberships):
        self.identity = identity
        self.memberships = memberships

    @classmethod
    def for_local_owner(
        cls,
        workspace_ids: Iterable[str],
        *,
        identity_id: str | None = "local-owner",
    ) -> LocalWorkspaceAuthorization:
        identity = LocalTrustedIdentityAdapter(identity_id)
        memberships = ServerWorkspaceMemberships(
            {identity_id: workspace_ids} if identity_id and identity_id.strip() else {}
        )
        return cls(identity, memberships)

    def authorize(self, requested_workspace_id: str) -> WorkspaceAuthorizationContext:
        workspace_id = requested_workspace_id.strip()
        if not workspace_id:
            raise WorkspaceMembershipDenied("workspace id is empty")
        identity = self.identity.resolve()
        if not self.memberships.is_member(identity.subject, workspace_id):
            raise WorkspaceMembershipDenied("identity is not a member of the requested workspace")
        return WorkspaceAuthorizationContext(identity=identity, workspace_id=workspace_id)

    def status(self) -> dict:
        return {
            "mode": LOCAL_AUTH_MODE,
            "local_only": True,
            "trusted_identity_configured": self.identity.configured,
            "production_auth": False,
            "oauth_or_idp": False,
            "database_rls": False,
        }
