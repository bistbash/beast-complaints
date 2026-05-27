import { initials } from '../../utils/format.ts';

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ name, src, size = 32, className = '' }: AvatarProps) {
  const dimension = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (src) {
    return (
      <img
        src={src}
        alt={name || 'avatar'}
        className={`rounded-full object-cover border border-subtle ${className}`}
        style={dimension}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center font-semibold ${className}`}
      style={dimension}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
