const TONE = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  ACTIVE: { tone: 'success', label: 'Active' },
  PAUSED: { tone: 'warning', label: 'Paused' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
};

export default function StatusPill({ status }) {
  const { tone, label } = TONE[status] ?? { tone: 'neutral', label: status };
  return <span className={`sp-pill ${tone}`}>{label}</span>;
}
