import type { Metadata } from 'next';

import { SPECIALISTS } from '@/lib/ai/specialists';
import { loadCompanySpace } from '@/lib/data/space';
import { pluralise } from '@/lib/format';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import { MeetingRoom } from '@/components/meetings/MeetingRoom';

export const metadata: Metadata = { title: 'Team Room' };

/**
 * The company's meeting room. One live meeting at a time, on purpose: a founder
 * cannot be in two rooms at once, and neither should their company.
 */
export default async function CompanyRoomPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company, data } = await loadCompanySpace(companyId);
  const meetings = [...data.meetings].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const specialistNames = Object.fromEntries(SPECIALISTS.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHead
        eyebrow={company.name}
        title="Team Room"
        lede="You, in the room with the specialists this topic needs. They answer from this company's real records, they can disagree with each other, and nothing they plan runs until you approve it."
        actions={<Badge tone="outline">{pluralise(meetings.length, 'meeting')} held</Badge>}
      />
      <div className="grid">
        <Panel span={12}>
          <MeetingRoom
            scopeKey={`company:${company.id}`}
            meetings={meetings}
            specialistNames={specialistNames}
          />
        </Panel>
      </div>
    </>
  );
}
