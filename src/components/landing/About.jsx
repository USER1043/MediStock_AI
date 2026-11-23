import React, { useState } from 'react';
import {
  Store,
  GraduationCap,
  ExternalLink,
  Boxes,
  BellRing,
  ReceiptIndianRupee,
  ShieldCheck,
  LineChart,
  History,
  Bot,
  Container,
  Github,
  Linkedin,
  UserRound,
  Rocket,
  Mic,
  Truck,
  BrainCircuit,
  SlidersHorizontal,
  Zap,
  FlaskConical,
  HeartPulse,
} from 'lucide-react';

// --- MODULAR CONFIGURATION (Swap details here) ---
const FACULTY_NAME = "Dr. T. Senthil Kumar";
const FACULTY_LINK = "https://www.amrita.edu/faculty/t-senthilkumar/";
const FACULTY_IMAGE = "/about/faculty-senthil-kumar.jpg";
const CLINIC_NAME = "Padmanaba Medicals";
const CLINIC_LINK = "https://share.google/2v5bEfTay9SK1lG3i";
const CLINIC_IMAGE = "/about/padmanaba-medicals.jpg";
const FACULTY_TITLE = "Professor, Dept. of Computer Science and Engineering";

// --- TEAM ---
const LEAD = {
  name: "Prajan Karthik V",
  title: "Lead Developer & Architect",
  image: "/team/prajan.jpg",
  summary: "Led the design and development of MediStock AI, from the inventory data model to the AI assistant, and runs its testing, deployment and releases.",
  github: "https://github.com/USER1043",
  linkedin: "https://linkedin.com/in/prajan-karthik",
  highlights: [
    { icon: Zap, title: "Answers in seconds", text: "Rebuilt the AI assistant around live inventory lookups, so most questions are answered in under 3 seconds." },
    { icon: FlaskConical, title: "Tested on every change", text: "Nearly 600 automated tests run in CI on every pull request." },
    { icon: HeartPulse, title: "Ready for small clinics", text: "Runs out of the box in any small clinic or pharmacy, built around the day-to-day needs of Padmanaba Medicals." },
  ],
  built: [
    { icon: Boxes, title: "Batch-level inventory", text: "Per-batch stock, racks and FEFO expiry tracking" },
    { icon: BellRing, title: "Alerts engine", text: "Low-stock and expiry alerts, raised and cleared automatically" },
    { icon: ReceiptIndianRupee, title: "Billing flow", text: "Keyboard-first billing, stock limits and safe rollback" },
    { icon: ShieldCheck, title: "Account security", text: "Password policy and access-control hardening" },
    { icon: LineChart, title: "Forecast review", text: "Workflow for approving reorder recommendations" },
    { icon: History, title: "Audit trail", text: "Activity log of who changed what, and when" },
    { icon: Bot, title: "AI assistant", text: "Inventory tool calls, Tamil and brand-name matching" },
    { icon: Container, title: "Delivery", text: "Docker stack, CI and automated releases" },
  ],
};

const CONTRIBUTORS = [
  {
    name: "Kanish Kumaran M",
    title: "Developer",
    summary: "Built the first prototype of MediStock AI, including the original billing, login and Tamil voice features.",
    image: "/team/kanish.jpg",
    github: "https://github.com/kanishmanickam",
    linkedin: "https://www.linkedin.com/in/kanishkumaranmm/",
    built: [
      { icon: Rocket, title: "Initial prototype", text: "First version of the MERN app" },
      { icon: ReceiptIndianRupee, title: "Billing & login", text: "First versions of billing and role checks" },
      { icon: Mic, title: "Tamil voice", text: "Chat widget and Tamil text-to-speech" },
      { icon: Truck, title: "Suppliers", text: "Supplier and reorder screens" },
    ],
  },
  {
    name: "Dheemant",
    title: "ML Developer",
    summary: "Built the LSTM model behind MediStock AI's demand forecasting.",
    image: "/team/dheemant.jpg",
    github: "https://github.com/dheemant-u",
    linkedin: "https://www.linkedin.com/in/dheemantumapathy/",
    built: [
      { icon: BrainCircuit, title: "Forecasting model", text: "LSTM demand forecasting with TensorFlow.js" },
      { icon: SlidersHorizontal, title: "Forecast setup", text: "Demand setup screen" },
    ],
  },
];

// Shows the photo, or the fallback icon in a same-sized tile if the photo is missing or fails to load
const PhotoOrIcon = ({ src, alt, fallback, className = "", fallbackClassName = "bg-white", sizeClassName = "w-16 h-16" }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div role="img" aria-label={alt} className={`${sizeClassName} rounded-xl shadow-sm flex items-center justify-center ${fallbackClassName}`}>
        {fallback}
      </div>
    );
  }
  return (
    <img src={src} alt={alt} onError={() => setFailed(true)} className={`${sizeClassName} rounded-xl object-cover shadow-sm ${className}`} />
  );
};

// One team member: the lead gets a larger photo, a title, a summary and a two-column list
const MemberCard = ({ person, lead = false }) => (
  <article className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
    <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500" />
    <div className={`${lead ? "p-6 sm:p-10" : "p-6 sm:p-8"} flex flex-col flex-grow`}>
      <div className={`flex ${lead ? "flex-col sm:flex-row sm:items-center gap-6 sm:gap-8" : "flex-col sm:flex-row sm:items-start gap-5"}`}>
        <div className={`p-1.5 rounded-2xl bg-emerald-50 shrink-0 ${lead ? "self-start sm:self-center" : "self-start"}`}>
          <PhotoOrIcon
            src={person.image}
            alt={person.name}
            sizeClassName={lead ? "w-28 h-28 sm:w-32 sm:h-32" : "w-20 h-20"}
            fallback={<UserRound className={lead ? "w-12 h-12 text-emerald-600" : "w-8 h-8 text-emerald-600"} />}
          />
        </div>
        <div className="space-y-3 min-w-0">
          <div>
            <h3 className={`${lead ? "text-3xl" : "text-2xl"} font-extrabold text-slate-900 tracking-tight`}>{person.name}</h3>
            {person.title && <p className="text-sm font-bold tracking-wide uppercase text-emerald-700 mt-1">{person.title}</p>}
          </div>
          {person.summary && <p className={`text-slate-600 leading-relaxed ${lead ? "text-lg" : ""}`}>{person.summary}</p>}
          <div className="flex flex-wrap gap-3">
            {person.github && (
              <a href={person.github} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} on GitHub`} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors">
                <Github className="w-4 h-4" aria-hidden="true" /> GitHub
              </a>
            )}
            <a href={person.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} on LinkedIn`} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm font-semibold hover:border-sky-400 hover:text-sky-700 transition-colors">
              <Linkedin className="w-4 h-4" aria-hidden="true" /> LinkedIn
            </a>
          </div>
        </div>
      </div>

      {person.highlights && (
        <ul className="mt-10 grid sm:grid-cols-3 gap-4">
          {person.highlights.map(({ icon: Icon, title, text }) => (
            <li key={title} className="p-5 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100">
              <Icon className="w-6 h-6 text-emerald-600 mb-3" aria-hidden="true" />
              <p className="font-bold text-slate-900">{title}</p>
              <p className="text-sm text-slate-600 leading-relaxed mt-1">{text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">{lead ? "What I built" : "Built"}</h4>
        <ul className={`grid gap-3 ${lead ? "sm:grid-cols-2" : ""}`}>
          {person.built.map(({ icon: Icon, title, text }) => (
            <li key={title} className={`flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-100 ${lead ? "p-3.5" : "p-4"}`}>
              <div className="p-2 rounded-lg bg-white shadow-sm text-emerald-600 shrink-0">
                <Icon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </article>
);

const About = () => {
  return (
    <div className="bg-slate-50 min-h-screen py-24 px-4 sm:px-6 lg:px-8 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      <div className="max-w-7xl mx-auto space-y-24">

        {/* Header & Mission Section */}
        <section className="text-center max-w-4xl mx-auto space-y-8 animate-fade-in-up">
          <div className="inline-flex items-center px-5 py-2 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold tracking-wide shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
            Project Overview
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight">
            About <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-700 to-slate-500">MediStock AI</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 leading-relaxed font-medium">
            MediStock AI is a clinical-grade pharmacy management platform designed to transform reactive inventory tracking into a proactive, data-driven ecosystem.
          </p>
        </section>

        {/* Collaborator & Faculty Section */}
        <section className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Collaborator Card */}
          <div className="bg-white rounded-xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-slate-200 flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 group">
            <div className="p-4 bg-slate-50 rounded-2xl group-hover:bg-slate-100 transition-colors shrink-0">
              <PhotoOrIcon src={CLINIC_IMAGE} alt={CLINIC_NAME} fallback={<Store className="w-8 h-8 text-slate-500" />} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">The Clinical Collaborator</p>
              <a href={CLINIC_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-2xl font-bold text-slate-900 mb-3 hover:text-blue-600 transition-colors group-hover:text-slate-700">
                {CLINIC_NAME}
                <ExternalLink className="w-5 h-5 ml-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all" />
              </a>
              <p className="text-slate-600 leading-relaxed">
                Partnering to provide real-world insights, ensuring our clinical-grade platform meets the rigorous, day-to-day operational demands of modern pharmacies.
              </p>
            </div>
          </div>

          {/* Project Mentorship Card */}
          <div className="bg-white rounded-xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-emerald-100 flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150"></div>
            <div className="p-1 bg-emerald-50 rounded-2xl group-hover:bg-emerald-100 transition-colors shrink-0 relative z-10 w-18 h-18">
              <PhotoOrIcon src={FACULTY_IMAGE} alt={FACULTY_NAME} fallback={<GraduationCap className="w-8 h-8 text-emerald-600" />} />
            </div>
            <div className="relative z-10">
              <p className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-2">Project Mentorship</p>
              <a href={FACULTY_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-2xl font-bold text-slate-900 mb-3 hover:text-emerald-600 transition-colors group-hover:text-emerald-800">
                {FACULTY_NAME}
                <ExternalLink className="w-5 h-5 ml-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all" />
              </a>
              <p className="text-slate-600 leading-relaxed italic mb-1">{FACULTY_TITLE}</p>
              <p className="text-slate-600 leading-relaxed">
                Providing expert architectural oversight and guidance, ensuring strict adherence to healthcare compliance and industry best practices.
              </p>
            </div>
          </div>
        </section>

        {/* The Team */}
        <section className="space-y-10 max-w-5xl mx-auto" aria-labelledby="team-heading">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 id="team-heading" className="text-4xl font-extrabold text-slate-900 tracking-tight">The Team</h2>
            <p className="text-lg text-slate-600 font-medium">The people who built MediStock AI.</p>
          </div>

          <MemberCard person={LEAD} lead />

          <div className="grid md:grid-cols-2 gap-8 items-start">
            {CONTRIBUTORS.map((person) => (
              <MemberCard key={person.name} person={person} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;