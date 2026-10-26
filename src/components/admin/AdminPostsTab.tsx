import React, { useState, useEffect } from 'react';
import {
  Search,
  Trash2,
  Heart,
  MessageCircle,
  FileText,
  AlertTriangle,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { AdminPostRecord } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { AdminTestingToolsModal } from './AdminTestingToolsModal';
import { registerBackInterceptor } from '../../services/backButtonService';

interface AdminPostsTabProps {
  posts: AdminPostRecord[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminPostsTab: React.FC<AdminPostsTabProps> = ({
  posts,
  loading,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteModal, setDeleteModal] = useState<AdminPostRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testingPost, setTestingPost] = useState<AdminPostRecord | null>(null);

  // Intercept back button for open modals in Admin Posts
  useEffect(() => {
    if (!deleteModal && !testingPost) return;

    return registerBackInterceptor(() => {
      if (deleteModal) {
        setDeleteModal(null);
        return true;
      }
      if (testingPost) {
        setTestingPost(null);
        return true;
      }
      return false;
    });
  }, [deleteModal, testingPost]);

  const filteredPosts = posts.filter((p) => {
    const term = searchTerm.toLowerCase().trim();
    return (
      !term ||
      p.caption?.toLowerCase().includes(term) ||
      p.user?.username?.toLowerCase().includes(term) ||
      p.user?.displayName?.toLowerCase().includes(term) ||
      p.id?.toLowerCase().includes(term)
    );
  });

  const handleDeletePost = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await adminService.deletePost(
        deleteModal.id,
        deleteReason.trim() || 'Administrative moderation removal'
      );
      setDeleteModal(null);
      setDeleteReason('');
      onRefresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to delete post.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="flex items-center gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search posts by caption, author username, or post ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>
      </div>

      <div className="text-xs text-slate-400 px-1">
        Showing <strong className="text-white">{filteredPosts.length}</strong> of{' '}
        <strong className="text-white">{posts.length}</strong> feed posts
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40">
          Loading posts...
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="p-12 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40">
          No posts found matching your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map((post) => (
            <div
              key={post.id}
              className="rounded-xl bg-slate-900/80 border border-slate-800 overflow-hidden flex flex-col justify-between shadow-sm"
            >
              <div>
                {/* Image */}
                {post.imageUrl ? (
                  <div className="relative aspect-square bg-slate-950 overflow-hidden">
                    <img
                      src={post.imageUrl}
                      alt={post.caption}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="p-6 bg-slate-950/60 text-slate-400 text-xs italic">
                    Text-only post
                  </div>
                )}

                {/* Author & Caption */}
                <div className="p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={post.user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                      alt={post.user?.displayName}
                      className="w-6 h-6 rounded-full object-cover border border-slate-700 shrink-0"
                    />
                    <span className="text-xs font-bold text-white truncate">
                      @{post.user?.username || 'user'}
                    </span>
                    <span className="text-[10px] text-slate-500 ml-auto">
                      {post.createdAt ? new Date(post.createdAt).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-3">
                    {post.caption || 'No caption'}
                  </p>

                  <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-400" />
                      <span>{post.likesCount || 0}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
                      <span>{post.commentsCount || 0}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-500 truncate max-w-[150px]">
                  ID: {post.id}
                </span>

                <button
                  type="button"
                  onClick={() => setDeleteModal(post)}
                  className="px-2.5 py-1 rounded text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Post Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Moderate & Delete Post</h3>
                <p className="text-xs text-slate-400">Post ID: {deleteModal.id}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Administrative Reason (Required)
              </label>
              <textarea
                rows={3}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Inappropriate content, spam, or community violation..."
                className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-xs text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModal(null);
                  setErrorMsg(null);
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeletePost}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Removing...' : 'Delete Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
