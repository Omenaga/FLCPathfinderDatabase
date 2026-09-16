import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { detailKind } from '../lib/format'

export default function MultiSelect({ compact = false, single = false, label, values, options, onChange, isOptionDisabled, exclusiveKey, groupKey, optionGroup, variantLabel, detailOptions, emptyMessage = 'No matching options' }: {
  single?: boolean;
  isOptionDisabled?: (option: string) => boolean;
  optionGroup?: (option: string) => string;
  detailOptions?: Record<string, readonly string[]>; compact?: boolean; label: string; values: string[]; options: readonly string[]; onChange: (values: string[]) => void; exclusiveKey?: (option: string) => string; groupKey?: (option: string) => string; variantLabel?: (option: string) => string; emptyMessage?: string
}) {
  const grouping = groupKey ?? exclusiveKey ?? optionGroup
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [detailSelections, setDetailSelections] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  function positionOptions() {
    const rect = input.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upward = below < 220 && above > below
    const height = Math.max(60, Math.min(220, upward ? above : below))
    setPosition({ position: 'fixed', left: rect.left, width: rect.width, top: upward ? 'auto' : rect.bottom + 4, bottom: upward ? window.innerHeight - rect.top + 4 : 'auto', maxHeight: height, zIndex: 30 })
  }
  function openOptions() { positionOptions(); setOpen(true) }
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', positionOptions)
    document.addEventListener('scroll', positionOptions, true)
    return () => { window.removeEventListener('resize', positionOptions); document.removeEventListener('scroll', positionOptions, true) }
  }, [open])
  const matches = options.filter(option => {
    const detail = option.split(' / ')[1] ?? ''
    const group = groupKey?.(option) ?? ''
    const typedDetail = detailOptions && Object.values(detailOptions).flat().some(value => text.toLowerCase().includes(value.toLowerCase()))
    return (!detailOptions?.[group] || typedDetail || detail === (detailSelections[group] ?? '')) && !values.includes(option) && option.toLowerCase().includes(text.trim().toLowerCase())
  })
  function disabled(option: string) {
    return !!isOptionDisabled?.(option) || values.includes(option) || !!groupKey && values.includes(groupKey(option)) || !!exclusiveKey && values.some(value => exclusiveKey(value) === exclusiveKey(option))
  }
  function add(option: string) {
    if (disabled(option)) return
    const remaining = groupKey && option === groupKey(option) ? values.filter(value => groupKey(value) !== option) : values
    onChange(single ? [option] : [...remaining, option]); setText(''); setActive(0); input.current?.focus()
    if (single) setOpen(false)
  }
  useEffect(() => {
    const form = input.current?.form
    const clear = () => { setDetailSelections({}); setText(''); setOpen(false); setActive(0) }
    form?.addEventListener('reset', clear)
    return () => form?.removeEventListener('reset', clear)
  }, [])
  return <div className={compact ? "multi-select compact-options" : "multi-select"} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" autoComplete="off" value={text} placeholder="Type or choose?"
      aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
      aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
      onFocus={openOptions} onClick={openOptions} onChange={event => { setText(event.target.value); setActive(0); openOptions() }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); openOptions()
          setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const exact = matches.find(option => option.toLowerCase() === text.trim().toLowerCase())
          if (exact || matches[active]) add(exact ?? matches[active])
          if (!single) openOptions()
        } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
    <div className="selected-options">{values.map(value => <button type="button" className="secondary" key={value}
      aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter(item => item !== value))}>{value}</button>)}</div>
    {open && <ul id={`${id}-options`} role="listbox" aria-label={`${label} options`} className="option-list" style={position}>
      {grouping ? [...new Set(matches.map(grouping))].map(level => <li key={level} role="presentation" className={groupKey ? "level-choice activity-year-choice" : "level-choice"}
        onMouseDown={event => { if (groupKey && !(event.target as HTMLElement).closest('button, select')) event.preventDefault() }}
        onClick={event => { if (groupKey && !(event.target as HTMLElement).closest('button, select')) add(level) }}>
        <div role="group" aria-label={level}>
          {groupKey ? <button type="button" className="level-name group-select" role="option" aria-label={level}
            id={matches.includes(level) ? `${id}-option-${matches.indexOf(level)}` : undefined}
            aria-selected={matches.indexOf(level) === active} aria-disabled={disabled(level)} disabled={disabled(level)}
            onMouseDown={event => event.preventDefault()} onClick={() => add(level)}>{level}</button>
            : <span className="level-name">{level}</span>}
          {detailOptions?.[level] && <select className="history-detail-select" aria-label={`${level} ${detailKind(level)}`} disabled={disabled(level)}
            value={detailSelections[level] ?? ''} onChange={event => { setDetailSelections(current => ({ ...current, [level]: event.target.value })); setActive(0) }}>
            <option value="">{`Any ${detailKind(level)}`}</option>
            {detailOptions[level].map(detail => <option key={detail}>{detail}</option>)}
          </select>}
          <div className="level-variants">{matches.filter(option => grouping(option) === level && (!groupKey || option !== level)).map(option => {
            const index = matches.indexOf(option)
            return <button type="button" role="option" tabIndex={-1} key={option} id={`${id}-option-${index}`}
              aria-label={option} aria-selected={index === active} aria-disabled={disabled(option)} disabled={disabled(option)}
              onMouseDown={event => event.preventDefault()} onClick={() => add(option)}>
              {variantLabel ? variantLabel(option) : option.endsWith(' (Any)') ? 'Any' : option.endsWith(' (Advanced)') ? 'Advanced' : 'Basic'}
            </button>
          })}</div>
        </div>
      </li>) : matches.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option" aria-selected={index === active} aria-disabled={disabled(option)}
        onMouseDown={event => event.preventDefault()} onClick={() => add(option)}>{option}</li>)}
      {!matches.length && <li role="presentation">{emptyMessage}</li>}
    </ul>}
  </div>
}
