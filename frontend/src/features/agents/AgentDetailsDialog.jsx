import { useEffect, useRef } from 'react';
import AgentIcon from './data/AgentIcon';

/** The whole of one agent's card (its full description and every tag) in a dialog, opened by the card's "More" link. */
export default function AgentDetailsDialog({ agent, onClose }) {
  const dialog = useRef(null);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  return (
    <dialog
      ref={dialog} className="agent-details-dialog" aria-labelledby="agent-details-title"
      onClose={onClose} onClick={(event) => event.target === dialog.current && dialog.current.close()}
    >
      <div className="agent-details-body">
        <div className="agent-details-head">
          <AgentIcon agentId={agent.id} />
          <div>
            <h3 id="agent-details-title" className="agent-card-title">{agent.catalogName}</h3>
            <span className="agent-card-badge">{agent.badge}</span>
          </div>
        </div>
        <p className="agent-details-desc">{agent.description}</p>
        <div className="agent-card-tags">
          {agent.tags.map((tag) => <span key={tag} className="agent-tag-pill">{tag}</span>)}
        </div>
        <button type="button" className="agent-details-close" onClick={() => dialog.current.close()}>Close</button>
      </div>
    </dialog>
  );
}
