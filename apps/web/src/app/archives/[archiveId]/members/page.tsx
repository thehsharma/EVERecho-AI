import { Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { MemberActions, InviteForm } from '@/components/members';
import { serverFetch } from '@/lib/server';
import type { Archive, Invitation, Membership } from '@everecho/contracts';

export const metadata = { title: 'People with access' };

const ROLE_LABEL: Record<string, string> = {
  storyteller: 'Storyteller',
  buyer: 'Set up the archive',
  family: 'Family member',
  contributor: 'Contributor',
  steward: 'Steward',
  support_admin: 'Support',
};

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ archiveId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { archiveId } = await params;
  const { invite } = await searchParams;

  const [archive, members, invitations] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ members: Membership[] }>(`/v1/archives/${archiveId}/members`),
    serverFetch<{ invitations: Invitation[] }>(`/v1/archives/${archiveId}/invitations`).catch(() => ({
      invitations: [] as Invitation[],
    })),
  ]);

  const canInvite = archive.viewerCapabilities.includes('invitation.create');
  const canRevoke = archive.viewerCapabilities.includes('membership.revoke');
  const needsStoryteller = !archive.storytellerUserId;

  return (
    <div className="stack-lg">
      <PageHeader
        title="People with access"
        lede={
          canRevoke
            ? 'You decide who is here. Removing someone takes effect immediately.'
            : 'Who the storyteller has given access to.'
        }
      />

      {needsStoryteller && canInvite ? (
        <Notice tone="warn" title="This archive has no storyteller yet">
          <p style={{ marginBottom: 0 }}>
            Invite the person it is about. Until they accept and set their own permissions, nothing
            can be recorded.
          </p>
        </Notice>
      ) : null}

      {canInvite ? (
        <Card>
          <h2>Invite someone</h2>
          <InviteForm
            archiveId={archiveId}
            defaultRole={invite === 'storyteller' || needsStoryteller ? 'storyteller' : 'family'}
            allowStoryteller={needsStoryteller}
          />
        </Card>
      ) : null}

      <Card>
        <h2>Current access</h2>
        <ul className="list-plain">
          {members.members.map((member) => (
            <li key={member.id} className="spread" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}>
              <div>
                <strong>{member.displayName}</strong>{' '}
                <Tag>{ROLE_LABEL[member.role] ?? member.role}</Tag>{' '}
                {member.status !== 'active' ? <Tag kind="danger">{member.status}</Tag> : null}
                <div className="small muted">{member.email}</div>
              </div>
              {canRevoke && member.role !== 'storyteller' && member.status === 'active' ? (
                <MemberActions archiveId={archiveId} membershipId={member.id} name={member.displayName} />
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {invitations.invitations.length > 0 ? (
        <Card>
          <h2>Invitations sent</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">State</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invitations.invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <th scope="row">
                      {invitation.displayName}
                      <div className="small muted">{invitation.email}</div>
                    </th>
                    <td>{ROLE_LABEL[invitation.role] ?? invitation.role}</td>
                    <td>
                      <Tag kind={invitation.status === 'accepted' ? 'approved' : 'draft'}>
                        {invitation.status === 'declined' ? 'Not taken up' : invitation.status}
                      </Tag>
                    </td>
                    <td className="small">{new Date(invitation.expiresAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            When someone declines, we are not given a reason to pass on. Please do not send another
            invitation.
          </p>
        </Card>
      ) : (
        <Empty title="No invitations sent yet" />
      )}
    </div>
  );
}
