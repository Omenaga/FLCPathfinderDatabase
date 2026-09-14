

export default function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)}><option value="">Any</option>{options.map(option => <option key={option}>{option}</option>)}</select></label>
}
