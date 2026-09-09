interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 26, className = "" }: LogoProps) {
  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-transform duration-200 hover:scale-105"
      >
        <defs>
          <linearGradient id="logo-repo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <linearGradient id="logo-node-accent" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="logo-box-bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <filter id="logo-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer isometric inventory container card */}
        <rect
          x="6"
          y="6"
          width="52"
          height="52"
          rx="14"
          fill="url(#logo-box-bg)"
          stroke="url(#logo-repo-grad)"
          strokeWidth="2.5"
        />

        {/* Subtle inner ambient shelf lines */}
        <path d="M14 44 H50" stroke="#334155" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M14 50 H50" stroke="#1e293b" strokeWidth="1.5" />

        {/* Git Branch Network inside Inventory Box */}
        {/* Main Trunk */}
        <path d="M24 18 V42" stroke="url(#logo-repo-grad)" strokeWidth="3.5" strokeLinecap="round" />

        {/* Branching Path */}
        <path
          d="M24 34 C 24 26, 42 32, 42 22"
          fill="none"
          stroke="url(#logo-repo-grad)"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Git Commit Nodes */}
        {/* Base Trunk Node */}
        <circle cx="24" cy="42" r="4" fill="#0f172a" stroke="url(#logo-repo-grad)" strokeWidth="3" />

        {/* Main Root Node (Glowing) */}
        <circle cx="24" cy="18" r="4.5" fill="url(#logo-repo-grad)" filter="url(#logo-glow)" />

        {/* Branch Tip Node (Healthy Emerald Accent) */}
        <circle cx="42" cy="22" r="4" fill="url(#logo-node-accent)" stroke="#0f172a" strokeWidth="1.5" />

        {/* Scanning indicator beam dot */}
        <circle cx="24" cy="30" r="2" fill="#38bdf8" />
      </svg>
    </div>
  );
}
