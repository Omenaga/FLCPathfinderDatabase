// Add/edit document one honor or Master Award per entry, using the shared grouped picker.
import HonorSelect, { type Honor } from '../../components/HonorSelect'
export type { Honor } from '../../components/HonorSelect'

export default function HonorPicker({
  value,
  onChange,
}: {
  value: Honor | null
  onChange: (value: Honor | null) => void
}) {
  return (
    <HonorSelect
      label="Find an honor"
      single
      values={value ? [value] : []}
      onChange={(values) => onChange(values[0] ?? null)}
    />
  )
}
