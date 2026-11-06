import { structure } from '../lib/richText';

const Parts = ({ parts }) => parts.map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>));

/** A chat answer with paragraphs, bullets, numbered lists and bold, instead of one block of text. */
export default function RichText({ text }) {
  return (
    <div className="ad-rich">
      {structure(text).map((block, i) => {
        if (block.type === 'p') return <p key={i} className={block.lead ? 'lead' : undefined}><Parts parts={block.parts} /></p>;
        const List = block.type;
        return <List key={i}>{block.items.map((parts, j) => <li key={j}><Parts parts={parts} /></li>)}</List>;
      })}
    </div>
  );
}
