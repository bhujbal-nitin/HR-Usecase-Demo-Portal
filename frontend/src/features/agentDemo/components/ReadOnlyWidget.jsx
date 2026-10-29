/**
 * The agent's answer card (header + key/value rows) inside a chat bubble.
 * In manual mode `onAction` is passed and the card's buttons become clickable; in auto-play the demo taps them itself.
 */
export default function ReadOnlyWidget({ widget, onAction }) {
  return (
    <div className="ad-widget">
      {widget.title && (
        <div className="ad-widget-head">
          <span><i className={`fa-solid ${widget.icon ?? 'fa-circle-info'}`}></i> {widget.title}</span>
          {widget.badge && <span className={`badge badge-${widget.badge.tone}`}>{widget.badge.label}</span>}
        </div>
      )}
      {widget.rows.length > 0 && (
        <table>
          <tbody>
            {widget.rows.map((row, index) => {
              const { cells, emphasis } = Array.isArray(row) ? { cells: row } : row;
              return (
                <tr key={index} className={emphasis ? `emph-${emphasis}` : undefined}>
                  {cells.map((cell, i) => <td key={i}>{i === 0 ? <b>{cell}</b> : cell}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {onAction && widget.actions?.length > 0 && (
        <div className="ad-widget-actions">
          {widget.actions.map((action) => (
            <button key={action.label} type="button" className="ad-widget-btn" onClick={() => onAction(action)}>
              <i className={`fa-solid ${action.icon}`}></i> {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
