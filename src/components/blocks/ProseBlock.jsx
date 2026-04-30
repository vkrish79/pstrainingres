export default function ProseBlock({ block }) {
  return (
    <div className="wb-prose" dangerouslySetInnerHTML={{ __html: block.config?.html || '' }} />
  );
}
