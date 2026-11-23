import { FaReact, FaNodeJs, FaFileExcel } from 'react-icons/fa';
import { SiVite, SiMongodb, SiExpress, SiTailwindcss, SiGooglegemini, SiJsonwebtokens } from 'react-icons/si';


const stack = [
  { name: 'React 18', icon: FaReact, color: '#61DAFB', desc: 'UI Framework' },
  { name: 'Vite', icon: SiVite, color: '#646CFF', desc: 'Build Tool' },
  { name: 'TailwindCSS', icon: SiTailwindcss, color: '#06B6D4', desc: 'Styling' },
  { name: 'Node.js', icon: FaNodeJs, color: '#68A063', desc: 'Runtime' },
  { name: 'Express', icon: SiExpress, color: '#888', desc: 'Backend API' },
  { name: 'MongoDB', icon: SiMongodb, color: '#47A248', desc: 'Database' },
  { name: 'Gemini AI', icon: SiGooglegemini, color: '#8B5CF6', desc: 'Chatbot Engine' },
  { name: 'JWT', icon: SiJsonwebtokens, color: '#F59E0B', desc: 'Auth Tokens' },
  { name: 'SheetJS', icon: FaFileExcel, color: '#217346', desc: 'Excel Parser' },
];

const TechStack = () => (
  <section id="techstack" className="py-24 bg-gray-950">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-14">
        <span className="inline-block px-4 py-1.5 bg-white/10 text-white/70 border border-white/20 rounded-full text-sm font-semibold mb-4">
          Tech Stack
        </span>
        <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
          Built with Modern Technologies
        </h2>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Industry-standard open-source tools carefully assembled for performance, security, and developer experience.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-9 gap-4">
        {stack.map((t, i) => (
          <div key={i}
            className="flex flex-col items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/10 hover:border-white/20 transition-all group cursor-default">
            <t.icon className="text-4xl group-hover:scale-110 transition-transform" style={{ color: t.color }} />
            <div className="text-center">
              <p className="text-white text-xs font-semibold">{t.name}</p>
              <p className="text-gray-500 text-xs">{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default TechStack;
