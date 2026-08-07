/**
 * The icon set.
 *
 * Hand-drawn on a 16px grid at a uniform 1.4 stroke weight rather than pulled
 * from a library. Two reasons: an icon library is a 200KB dependency for the
 * thirty glyphs this product uses, and a bespoke set is part of what stops the
 * interface looking assembled from parts.
 */

export type IconName =
  | 'home'
  | 'brain'
  | 'building'
  | 'life'
  | 'assistant'
  | 'settings'
  | 'compass'
  | 'megaphone'
  | 'handshake'
  | 'diamond'
  | 'code'
  | 'coins'
  | 'gear'
  | 'users'
  | 'scale'
  | 'telescope'
  | 'sparkle'
  | 'bolt'
  | 'crown'
  | 'pulse'
  | 'heart'
  | 'book'
  | 'inbox'
  | 'factory'
  | 'search'
  | 'plus'
  | 'check'
  | 'close'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-up-right'
  | 'alert'
  | 'clock'
  | 'calendar'
  | 'file'
  | 'shield'
  | 'plug'
  | 'panel'
  | 'menu'
  | 'sun';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M2.5 6.8 8 2.5l5.5 4.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z" />,
  brain: (
    <>
      <path d="M8 3v10" />
      <path d="M8 4.2a2 2 0 1 0-3.2 1.6A2 2 0 0 0 3.6 9a2 2 0 0 0 1.7 3A1.8 1.8 0 0 0 8 11.6" />
      <path d="M8 4.2a2 2 0 1 1 3.2 1.6A2 2 0 0 1 12.4 9a2 2 0 0 1-1.7 3A1.8 1.8 0 0 1 8 11.6" />
    </>
  ),
  building: (
    <>
      <path d="M3 13.5V3.2a.7.7 0 0 1 .7-.7h5.6a.7.7 0 0 1 .7.7v10.3" />
      <path d="M10 6.5h2.3a.7.7 0 0 1 .7.7v6.3" />
      <path d="M5.2 5.3h2.4M5.2 8h2.4M5.2 10.6h2.4M2 13.5h12" />
    </>
  ),
  life: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.6v3.6l2.4 1.4" />
    </>
  ),
  assistant: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="8" cy="8" r="5.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="1.9" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
    </>
  ),
  compass: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m10.3 5.7-1.4 3.2-3.2 1.4 1.4-3.2z" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 6.6v2.8a.9.9 0 0 0 .9.9h1.4L11 13.2V2.8L5.3 5.7H3.9a.9.9 0 0 0-.9.9z" />
      <path d="M13 6.2a2.4 2.4 0 0 1 0 3.6" />
    </>
  ),
  handshake: (
    <>
      <path d="M2 7.4 4.7 5l2.1 1.6a1 1 0 0 0 1.2 0L10 5l4 2.6" />
      <path d="m6 9.4 1.6 1.4a1.1 1.1 0 0 0 1.5-.1L11 8.6" />
      <path d="M2 7.4v2.1l2.6 2M14 7.6v1.9l-2.4 2" />
    </>
  ),
  diamond: <path d="M8 2 14 8l-6 6-6-6z" />,
  code: <path d="m5.6 4.8-3.4 3.3 3.4 3.2M10.4 4.8l3.4 3.3-3.4 3.2M9.3 3.1 6.7 13" />,
  coins: (
    <>
      <ellipse cx="8" cy="4.4" rx="5" ry="2.1" />
      <path d="M3 4.4v3.3c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V4.4" />
      <path d="M3 7.7v3.4c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V7.7" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M13.1 9.6a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 1 1-1.7 1.7l-.1-.1a1 1 0 0 0-1.7.7v.2a1.2 1.2 0 1 1-2.4 0v-.1a1 1 0 0 0-1.7-.7l-.1.1a1.2 1.2 0 1 1-1.7-1.7l.1-.1a1 1 0 0 0-.7-1.7h-.2a1.2 1.2 0 1 1 0-2.4h.1a1 1 0 0 0 .7-1.7l-.1-.1a1.2 1.2 0 1 1 1.7-1.7l.1.1a1 1 0 0 0 1.7-.7v-.2a1.2 1.2 0 1 1 2.4 0v.1a1 1 0 0 0 1.7.7l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0 .7 1.7h.2a1.2 1.2 0 1 1 0 2.4h-.1a1 1 0 0 0-.9.6z" />
    </>
  ),
  users: (
    <>
      <circle cx="6.2" cy="5.6" r="2.2" />
      <path d="M1.9 13.2a4.4 4.4 0 0 1 8.6 0" />
      <path d="M10.6 3.7a2.2 2.2 0 0 1 0 3.9M11.6 9.4a4.4 4.4 0 0 1 2.5 3.8" />
    </>
  ),
  scale: (
    <>
      <path d="M8 2.6v10.8M4.4 13.4h7.2M2 6.4h12M4.6 3.9 2 6.4M11.4 3.9 14 6.4" />
      <path d="M2 6.4 3.6 10h-3.2zM14 6.4 15.6 10h-3.2z" />
    </>
  ),
  telescope: (
    <>
      <path d="m2.4 8.6 7-4.4 1.8 2.9-7 4.4z" />
      <path d="m11.3 3.2 1.9 3M6.8 10.2 8.4 13M8.4 13H5.6" />
    </>
  ),
  sparkle: (
    <>
      <path d="M8 2.2 9.3 6 13 7.3 9.3 8.6 8 12.4 6.7 8.6 3 7.3 6.7 6z" />
      <path d="M12.6 11.2 13 12.4l1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4z" />
    </>
  ),
  bolt: <path d="M9 1.8 3.6 8.8h3.6l-.4 5.4L13 7.2H9.4z" />,
  crown: <path d="M2.4 11.8h11.2M2.4 11.8 3.4 4.6l3 2.6L8 3.4l1.6 3.8 3-2.6 1 7.2z" />,
  pulse: <path d="M1.6 8.2h2.9l1.6-4 2.6 8.2 1.7-4.2h3.6" />,
  heart: <path d="M8 13.2S2.4 10 2.4 6.2A2.9 2.9 0 0 1 8 4.8a2.9 2.9 0 0 1 5.6 1.4C13.6 10 8 13.2 8 13.2z" />,
  book: (
    <>
      <path d="M2.8 3.4a1 1 0 0 1 1-1H7a1.6 1.6 0 0 1 1 .5 1.6 1.6 0 0 1 1-.5h3.2a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1H9.4A1.6 1.6 0 0 0 8 13.4a1.6 1.6 0 0 0-1.4-.8H3.8a1 1 0 0 1-1-1z" />
      <path d="M8 2.9v10.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M2.4 8.6h3l.9 1.8h3.4l.9-1.8h3" />
      <path d="M4.1 3.2h7.8l1.7 5.4v3.6a.8.8 0 0 1-.8.8H3.2a.8.8 0 0 1-.8-.8V8.6z" />
    </>
  ),
  factory: (
    <>
      <path d="M2.2 13.4V7l3.6 2.2V7l3.6 2.2V7l3.6 2.2v4.2z" />
      <path d="M2.2 7V4.2h2.2V7M5.4 13.4v-2.6h2v2.6" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  check: <path d="m3.2 8.4 3.2 3.2 6.4-7.2" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  'chevron-right': <path d="m6.2 3.6 4.4 4.4-4.4 4.4" />,
  'chevron-down': <path d="m3.6 6.2 4.4 4.4 4.4-4.4" />,
  'arrow-up-right': <path d="M5 11 11 5M6 4.8h5.2V10" />,
  alert: (
    <>
      <path d="M8 2.6 14.2 13H1.8z" />
      <path d="M8 6.6v3M8 11.2v.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.1" />
      <path d="M2.4 6.6h11.2M5.4 2.2v2.4M10.6 2.2v2.4" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.4h4.6L12 5.8v7.8H4z" />
      <path d="M8.4 2.4v3.6H12" />
    </>
  ),
  shield: <path d="M8 2.2 13 4v4c0 3-2.2 4.8-5 5.8C5.2 12.8 3 11 3 8V4z" />,
  plug: (
    <>
      <path d="M6 2v3.5M10 2v3.5" />
      <path d="M4 5.5h8v2.2A3.8 3.8 0 0 1 8.2 11.5h-.4A3.8 3.8 0 0 1 4 7.7z" />
      <path d="M8 11.5V14" />
    </>
  ),
  panel: (
    <>
      <rect x="2.4" y="3" width="11.2" height="10" rx="1.1" />
      <path d="M10 3v10" />
    </>
  ),
  menu: <path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.6v1.4M8 13v1.4M14.4 8H13M3 8H1.6M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  className?: string;
  size?: number;
  title?: string;
}

export function Icon({ name, className, size = 16, title }: IconProps) {
  const glyph = PATHS[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}

/** True when a registry entry names an icon that exists. Asserted in tests. */
export function isIconName(value: string): value is IconName {
  return value in PATHS;
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
