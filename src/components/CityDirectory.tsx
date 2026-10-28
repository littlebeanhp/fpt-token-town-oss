'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ModelDefinition, StopId } from '@/types/factory';
import { formatCompact, formatExact, ranked, stops, usageIn } from '@/data/models';

/** The city's name board: every district, its vendor mark and the tokens it served this week. */
export function CityDirectory({
  selected,
  onSelect,
  onClose,
}: {
  selected: StopId;
  onSelect: (id: StopId) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const leader = ranked[0].usage;
  const visit = (model: ModelDefinition) => {
    onSelect(model.id);
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="api-dialog directory-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-top">
        <span className="eyebrow">CITY DIRECTORY</span>
        <button
          className="icon-button"
          aria-label="Close city directory"
          title="Close"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <h2>Seven houses, one city.</h2>
      <p>
        {formatExact(usageIn('tokens'))} tokens and {formatExact(usageIn('characters'))} characters
        this week across {stops.length} model districts.
      </p>
      <table className="directory-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Model</th>
            <th scope="col">District</th>
            <th scope="col" className="numeric">
              This week
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((model, index) => (
            <tr key={model.id} className={model.id === selected ? 'current' : ''}>
              <td className="rank">{index + 1}</td>
              <th scope="row">
                <button
                  onClick={() => visit(model)}
                  aria-label={`Visit ${model.name}`}
                  title={`Visit ${model.name}`}
                >
                  <img src={`/logos/${model.logo}.svg`} alt="" width={22} height={22} />
                  <span>
                    {model.name}
                    <small>{model.brand}</small>
                  </span>
                </button>
              </th>
              <td className="district">
                <span className="label-dot" style={{ background: model.color }} />
                {model.category}
              </td>
              <td className="numeric">
                <strong>{formatCompact(model.usage)}</strong>
                <span className="share-track" aria-hidden>
                  <span
                    className="share-fill"
                    style={{
                      // The smallest district still gets a visible sliver instead of nothing.
                      width: `${Math.max((model.usage / leader) * 100, 0.7)}%`,
                      background: model.color,
                    }}
                  />
                </span>
                <small>
                  {formatExact(model.usage)} {model.unit}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="api-note">
        Usage comes from this week's report; speech is metered in characters, everything else in
        tokens. Context windows and prices come from the serverless catalog. Vendor marks belong to
        their owners.
      </p>
      <button className="primary-button" onClick={onClose}>
        Back to the city
      </button>
    </dialog>
  );
}
