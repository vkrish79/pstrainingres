import { useSignedWorkbookHtml } from '../../lib/workbookImages.js';

export default function ProseBlock({ block }) {
  // Imported screenshots are stored as <img data-wb-image="path">; this hands
  // back the HTML with each one's signed src filled in.
  const html = useSignedWorkbookHtml(block.config?.html || '');
  return (
    <div className="wb-prose" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
