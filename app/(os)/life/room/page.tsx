import type { Metadata } from 'next';

import { SPECIALISTS } from '@/lib/ai/specialists';
import { loadPersonalSpace } from '@/lib/data/space';
import { pluralise } from '@/lib/format';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';
import { MeetingRoom } from '@/components/meetings/MeetingRoom';

export const metadata: Metadata = { title: 'Council' };

/** The personal life council — the same room, pointed at your own life. */
export default async function LifeRoomPage() {
  const { personal, data } = await loadPersonalSpace();
  const meetings = [...data.meetings].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const specialistNames = Object.fromEntries(SPECIALISTS.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHead
        eyebrow={personal.displayName}
        title="Council"
        lede="The personal-life version of the team room: health, relationships, learning and life-ops voices, answering from your own records, planning nothing without your approval."
        actions={<Badge tone="outline">{pluralise(meetings.length, 'session')} held</Badge>}
      />
      <div className="grid">
        <Panel span={12}>
          <MeetingRoom scopeKey="personal" meetings={meetings} specialistNames={specialistNames} />
        </Panel>
      </div>
    </>
  );
}
