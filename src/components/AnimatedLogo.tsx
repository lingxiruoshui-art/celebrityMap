import { motion } from "motion/react";

export default function AnimatedLogo() {
  return (
    <motion.div 
      className="relative group cursor-default"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.9, rotate: 5 }}
      onClick={() => {
        // We can add a simple state if we wanted complex multi-stage animations, 
        // but for now simple spring transitions on tap are good.
      }}
    >
      <svg viewBox="0 0 100 100" className="w-8 h-8 md:w-9 md:h-9">
        {/* Glow Filter */}
        <defs>
          <filter id="logo-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <clipPath id="globe-clip">
            <circle cx="50" cy="50" r="40" />
          </clipPath>
          <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
        </defs>

        {/* Outer Glowing Ring */}
        <motion.circle 
          cx="50" 
          cy="50" 
          r="48" 
          fill="none" 
          stroke="url(#logo-gradient)" 
          strokeWidth="0.5"
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          whileTap={{ strokeWidth: 2, scale: 1.1 }}
        />
        
        {/* Globe Base */}
        <circle cx="50" cy="50" r="40" className="fill-indigo-50/50" stroke="#e0e7ff" strokeWidth="1" />
        
        {/* Rotating Continents */}
        <g clipPath="url(#globe-clip)">
          <motion.g
            animate={{ x: [-160, 0] }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            style={{ filter: "url(#logo-glow)" }}
          >
            {/* Simple stylized continent shapes duplicated for seamless loop */}
            {[0, 160].map((offset) => (
              <g key={offset} transform={`translate(${offset}, 0)`} className="fill-indigo-400 group-hover:fill-indigo-500 transition-colors">
                <path d="M10,40 Q15,30 25,35 T40,30 Q50,40 45,55 T30,65 Q20,60 10,40 Z" />
                <path d="M60,20 Q75,15 85,25 T90,45 Q85,60 70,55 T60,40 Q55,30 60,20 Z" />
                <path d="M110,50 Q120,40 135,45 T145,65 Q135,80 120,75 T110,60 Z" />
                <path d="M30,80 Q45,75 55,85 T40,95 Q25,95 20,85 Z" />
              </g>
            ))}
          </motion.g>
        </g>

        {/* Globe Grid Overlays (Faded) */}
        <g className="stroke-indigo-200/40" strokeWidth="0.5" fill="none">
          <circle cx="50" cy="50" r="40" />
          <ellipse cx="50" cy="50" rx="20" ry="40" />
          <ellipse cx="50" cy="50" rx="40" ry="20" />
        </g>

        {/* Central Nucleus (Earth Core) */}
        <motion.circle 
          cx="50" 
          cy="50" 
          r="16" 
          className="fill-indigo-600 shadow-xl"
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.8, 1, 0.8]
          }}
          transition={{ duration: 4, repeat: Infinity }}
          whileTap={{ scale: 1.3, fill: "#4338ca" }}
        />

        {/* Person Silhouette */}
        <g fill="white">
          <circle cx="50" cy="46" r="5" />
          <path d="M40 60 C40 53 44 51 50 51 S60 53 60 60" />
        </g>

        {/* Orbiting Particles */}
        {[0, 120, 240].map((angle, i) => (
          <motion.circle
            key={i}
            r="2"
            fill="#818cf8"
            animate={{
              cx: 50 + 35 * Math.cos((angle * Math.PI) / 180),
              cy: 50 + 35 * Math.sin((angle * Math.PI) / 180),
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "linear",
            }}
            style={{
              x: 0,
              y: 0,
              transformOrigin: "50px 50px",
              rotate: angle
            }}
          />
        ))}

      </svg>
    </motion.div>
  );
}
