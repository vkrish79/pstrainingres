import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import TopBar from '../components/TopBar.jsx';
import PrepUploadModal from '../components/prep/PrepUploadModal.jsx';

// Full-page host for the prep manager — the same component the TopBar opens as a
// modal, rendered with room to breathe (the kit grid gets wide). Deep-linkable
// via ?kind=&vendor=&parent= so "⤢ Full page" lands on the same pool.
export default function PrepPage() {
  const { profile } = useAuth();
  const [sp] = useSearchParams();
  return (
    <>
      <TopBar />
      <PrepUploadModal
        variant="page"
        profile={profile}
        initialKind={sp.get('kind') || undefined}
        initialVendorId={sp.get('vendor') || undefined}
        initialParentId={sp.get('parent') || undefined}
      />
    </>
  );
}
