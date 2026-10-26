import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { CreateIntent, PostLocationData } from '../types';
import { Button } from '../components/Button';
import * as postsService from '../services/postsService';
import * as storiesService from '../services/storiesService';
import * as storageService from '../services/storageService';
import * as videosService from '../services/videosService';
import {
  searchLocations,
  LocationSuggestion,
} from '../services/locationAutocompleteService';
import {
  searchTags,
  TagSuggestion,
  parseNormalizedTags,
  getActiveTagContext,
  applySelectedTagToInput,
  recordUsedTagsInCache,
} from '../services/tagAutocompleteService';
import { preloadStoryImage, getOptimizedStoryThumbnailUrl } from '../lib/utils';
import { UploadCloud, MapPin, Hash, Check, Sparkles, Film, Video, AlertCircle, Copy, RefreshCw, Loader2, X } from 'lucide-react';

export interface CreatePostProps {
  initialMode?: CreateIntent;
  onCreated: (type?: 'feed' | 'story' | 'video') => void;
  onCancel?: () => void;
}

function resolvePostTypeFromIntent(intent?: CreateIntent): 'feed' | 'story' | 'video' {
  if (intent === 'reel') return 'video';
  if (intent === 'story') return 'story';
  return 'feed';
}

const PRESET_PHOTOS = [
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=1200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80',
];

function createDraftId(userId?: string): string {
  const uidPart = (userId || 'usr').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `${uidPart}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export const CreatePost: React.FC<CreatePostProps> = ({ initialMode, onCreated, onCancel }) => {
  const { currentUser } = useAuth();
  const [postType, setPostType] = useState<'feed' | 'story' | 'video'>(() =>
    resolvePostTypeFromIntent(initialMode)
  );

  // Sync mode if navigation intent changes while CreatePost is mounted
  useEffect(() => {
    setPostType(resolvePostTypeFromIntent(initialMode));
    setError('');
  }, [initialMode]);
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [imageUploadProgress, setImageUploadProgress] = useState<number>(0);
  const [imageUploadPhase, setImageUploadPhase] = useState<'idle' | 'uploading' | 'retrying' | 'processing'>('idle');
  const [imageStatusMessage, setImageStatusMessage] = useState<string>('');

  const [caption, setCaption] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [location, setLocation] = useState('');
  const [selectedLocationData, setSelectedLocationData] = useState<PostLocationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoDiagnostic, setVideoDiagnostic] = useState<storageService.VideoUploadDiagnostic | null>(null);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);

  // Location Autocomplete states
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const [hasSearchedLocation, setHasSearchedLocation] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState(false);

  // Tag Autocomplete states
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [isTagLoading, setIsTagLoading] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  // Video-specific states
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'retrying' | 'processing'>('idle');
  const [videoStatusMessage, setVideoStatusMessage] = useState<string>('');

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const locationContainerRef = useRef<HTMLDivElement | null>(null);
  const locationInputRef = useRef<HTMLInputElement | null>(null);
  const tagsContainerRef = useRef<HTMLDivElement | null>(null);
  const tagsInputRef = useRef<HTMLInputElement | null>(null);
  const locationAbortRef = useRef<AbortController | null>(null);
  const tagAbortRef = useRef<AbortController | null>(null);
  const locationReqSeqRef = useRef<number>(0);
  const tagReqSeqRef = useRef<number>(0);
  const suppressNextLocationSearchRef = useRef<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const imageAbortControllerRef = useRef<AbortController | null>(null);
  const videoPreviewUrlRef = useRef<string>('');
  const imagePreviewUrlRef = useRef<string>('');
  const draftIdRef = useRef<string>(createDraftId(currentUser?.id));
  const uploadedVideoResultRef = useRef<{ file: File; result: storageService.VideoUploadResult } | null>(null);
  const videoPreparePromiseRef = useRef<Promise<File> | null>(null);

  // Close autocomplete dropdowns when clicking/tapping outside
  useEffect(() => {
    const handleOutsidePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (
        locationContainerRef.current &&
        target &&
        !locationContainerRef.current.contains(target)
      ) {
        setIsLocationDropdownOpen(false);
      }
      if (
        tagsContainerRef.current &&
        target &&
        !tagsContainerRef.current.contains(target)
      ) {
        setIsTagDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, []);

  // Debounced Location Autocomplete effect (300ms debounce, min 2 characters, stale request cancellation)
  useEffect(() => {
    if (postType !== 'feed') {
      setIsLocationDropdownOpen(false);
      return;
    }

    if (suppressNextLocationSearchRef.current) {
      suppressNextLocationSearchRef.current = false;
      return;
    }

    const trimmed = location.trim();
    if (trimmed.length < 2) {
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
        locationAbortRef.current = null;
      }
      setLocationSuggestions([]);
      setIsLocationLoading(false);
      setHasSearchedLocation(false);
      setLocationSearchError(false);
      setIsLocationDropdownOpen(false);
      return;
    }

    setIsLocationDropdownOpen(true);
    setIsLocationLoading(true);
    setLocationSearchError(false);

    const reqId = ++locationReqSeqRef.current;
    const timer = setTimeout(async () => {
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
      }
      const controller = new AbortController();
      locationAbortRef.current = controller;

      try {
        const results = await searchLocations(trimmed, {
          signal: controller.signal,
          limit: 6,
        });
        if (reqId !== locationReqSeqRef.current || controller.signal.aborted) {
          return;
        }
        setLocationSuggestions(results);
        setHasSearchedLocation(true);
        setLocationSearchError(false);
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted || reqId !== locationReqSeqRef.current) {
          return;
        }
        setLocationSuggestions([]);
        setHasSearchedLocation(true);
        setLocationSearchError(true);
      } finally {
        if (reqId === locationReqSeqRef.current && !controller.signal.aborted) {
          setIsLocationLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [location, postType]);

  // Debounced Tag Autocomplete effect (250ms debounce, min 2 characters, stale request cancellation)
  useEffect(() => {
    if (postType === 'story') {
      setIsTagDropdownOpen(false);
      return;
    }

    const { activeQuery, completedTags } = getActiveTagContext(tagsInput);
    if (activeQuery.length < 2) {
      if (tagAbortRef.current) {
        tagAbortRef.current.abort();
        tagAbortRef.current = null;
      }
      setTagSuggestions([]);
      setIsTagLoading(false);
      setIsTagDropdownOpen(false);
      return;
    }

    setIsTagDropdownOpen(true);
    setIsTagLoading(true);

    const reqId = ++tagReqSeqRef.current;
    const timer = setTimeout(async () => {
      if (tagAbortRef.current) {
        tagAbortRef.current.abort();
      }
      const controller = new AbortController();
      tagAbortRef.current = controller;

      try {
        const results = await searchTags(activeQuery, {
          excludeTags: completedTags,
          limit: 6,
          signal: controller.signal,
        });
        if (reqId !== tagReqSeqRef.current || controller.signal.aborted) {
          return;
        }
        setTagSuggestions(results);
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted || reqId !== tagReqSeqRef.current) {
          return;
        }
        setTagSuggestions([]);
      } finally {
        if (reqId === tagReqSeqRef.current && !controller.signal.aborted) {
          setIsTagLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [tagsInput, postType]);

  const handleSelectLocationSuggestion = (item: LocationSuggestion) => {
    suppressNextLocationSearchRef.current = true;
    setLocation(item.name);
    setSelectedLocationData({
      name: item.name,
      placeId: item.placeId,
      latitude: item.latitude,
      longitude: item.longitude,
      country: item.country,
    });
    setIsLocationDropdownOpen(false);
    setIsLocationLoading(false);
  };

  const handleSelectTagSuggestion = (tag: string) => {
    const nextValue = applySelectedTagToInput(tagsInput, tag);
    setTagsInput(nextValue);
    setTagSuggestions([]);
    setIsTagDropdownOpen(false);
    setIsTagLoading(false);
    requestAnimationFrame(() => {
      tagsInputRef.current?.focus();
    });
  };

  const handleRemoveCompletedTag = (tagToRemove: string) => {
    const { activeQuery, completedTags, hasTrailingSeparator } = getActiveTagContext(tagsInput);
    const remaining = completedTags.filter((t) => t !== tagToRemove);
    if (activeQuery && !hasTrailingSeparator) {
      setTagsInput(
        remaining.length > 0 ? `${remaining.join(', ')}, ${activeQuery}` : activeQuery
      );
    } else {
      setTagsInput(remaining.length > 0 ? `${remaining.join(', ')}, ` : '');
    }
  };

  // Keep preview URL refs updated for unmount cleanup
  useEffect(() => {
    videoPreviewUrlRef.current = videoPreviewUrl;
  }, [videoPreviewUrl]);

  useEffect(() => {
    imagePreviewUrlRef.current = imagePreviewUrl;
  }, [imagePreviewUrl]);

  // Clean up on actual unmount only (empty dependency array).
  // Prevents re-running cleanup and accidentally aborting an active upload on state updates.
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (imageAbortControllerRef.current) {
        imageAbortControllerRef.current.abort();
        imageAbortControllerRef.current = null;
      }
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
        locationAbortRef.current = null;
      }
      if (tagAbortRef.current) {
        tagAbortRef.current.abort();
        tagAbortRef.current = null;
      }
      if (videoPreviewUrlRef.current) {
        URL.revokeObjectURL(videoPreviewUrlRef.current);
      }
      if (imagePreviewUrlRef.current) {
        URL.revokeObjectURL(imagePreviewUrlRef.current);
      }
    };
  }, []);

  const uploadSelectedImageFile = async (file: File): Promise<string> => {
    if (imageAbortControllerRef.current) {
      imageAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    imageAbortControllerRef.current = controller;

    setImageUploadPhase('uploading');
    setImageUploadProgress(0);
    setImageStatusMessage('Uploading photo…');

    try {
      const secureUrl = await storageService.uploadImage(file, {
        onProgress: (percent) => {
          setImageUploadProgress(percent);
        },
        onStatusChange: (status) => {
          setImageUploadPhase(status.phase);
          setImageStatusMessage(status.message);
        },
        signal: controller.signal,
      });
      setImageUrl(secureUrl);
      // Immediately warm the Story thumbnail derivative and image URL in the background
      preloadStoryImage(getOptimizedStoryThumbnailUrl(secureUrl));
      preloadStoryImage(secureUrl);
      setImageUploadPhase('idle');
      setImageStatusMessage('');
      return secureUrl;
    } catch (err) {
      setImageUploadPhase('idle');
      setImageStatusMessage('');
      throw err;
    } finally {
      if (imageAbortControllerRef.current === controller) {
        imageAbortControllerRef.current = null;
      }
    }
  };

  // Image file handler with instant preview + resilient Cloudinary upload with automatic retry
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    if (!file) return;

    if (file.type && !file.type.startsWith('image/')) {
      setError('Please select a valid image file (JPG, PNG, or WebP).');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('Image is too large. Please select a photo under 15MB.');
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    const preview = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreviewUrl(preview);
    setImageUrl('');
    setError('');
    draftIdRef.current = createDraftId(currentUser?.id);

    try {
      setLoading(true);
      await uploadSelectedImageFile(file);
    } catch (err) {
      if (err instanceof Error && err.message.includes('cancelled')) {
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Upload failed. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClearImage = () => {
    if (imageAbortControllerRef.current) {
      imageAbortControllerRef.current.abort();
      imageAbortControllerRef.current = null;
    }
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl('');
    setImageUrl('');
    setImageUploadProgress(0);
    setImageUploadPhase('idle');
    setImageStatusMessage('');
    setError('');
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  // Video file picker handler
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // IMPORTANT: Do NOT set videoInputRef.current.value = '' here!
    // In Android WebView (Capacitor), clearing <input type="file">.value immediately after selection
    // invalidates the native FileList / content:// handle before the video is uploaded.
    if (!file) return;

    const rawName = file.name || '';
    const hasValidMime = Boolean(
      file.type && (file.type.startsWith('video/') || file.type === 'application/octet-stream')
    );
    const hasValidExt = /\.(mp4|webm|mov|m4v|3gp|mkv|avi)$/i.test(rawName);

    // Check video format (allow Android picker files with video/* or valid video extensions)
    if (!hasValidMime && !hasValidExt && file.type) {
      setError('Please select a valid video file (MP4, WebM, MOV)');
      return;
    }

    // Check size limit: 100MB max
    if (file.size > 100 * 1024 * 1024) {
      setError('Video is too large. Maximum supported size is 100MB.');
      return;
    }

    const { fileName, mimeType } = storageService.normalizeVideoFileMetadata(file);

    console.info(`[Reel Upload] Selected file: ${fileName}`);
    console.info(`[Reel Upload] File size: ${file.size} bytes (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    console.info(`[Reel Upload] MIME type: ${mimeType}`);

    setError('');
    setVideoDiagnostic(null);
    setVideoFile(file);
    uploadedVideoResultRef.current = null;
    draftIdRef.current = createDraftId(currentUser?.id);

    // Abort previous in-flight upload if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Create local object URL for instant preview
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    const preview = URL.createObjectURL(file);
    setVideoPreviewUrl(preview);
    setUploadProgress(0);
    setUploadPhase('idle');
    setVideoStatusMessage('');

    // For videos up to 50MB, eagerly snapshot the Android content:// stream into a memory-backed File
    // while the Android file-chooser URI grant is freshly active. This prevents content:// URI expiration
    // and <video> preview stream contention when the user taps "Publish Video Reel" later.
    if (file.size <= 50 * 1024 * 1024) {
      const lastModified = file.lastModified || Date.now();
      const prepareTask = storageService
        .readSliceAsMemoryBlob(file, 0, file.size, mimeType)
        .then((memoryBlob) => {
          const memoryFile = new File([memoryBlob], fileName, {
            type: mimeType,
            lastModified,
          });
          setVideoFile((current) => (current === file ? memoryFile : current));
          return memoryFile;
        })
        .catch(() => file);
      videoPreparePromiseRef.current = prepareTask;
    } else {
      videoPreparePromiseRef.current = Promise.resolve(file);
    }
  };

  const handleClearVideo = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setVideoFile(null);
    setVideoPreviewUrl('');
    setUploadProgress(0);
    setUploadPhase('idle');
    setVideoStatusMessage('');
    setLoading(false);
    setError('');
    setVideoDiagnostic(null);
    setDiagnosticCopied(false);
    uploadedVideoResultRef.current = null;
    videoPreparePromiseRef.current = null;
    isSubmittingRef.current = false;
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    // Guard against duplicate submission calls
    if (isSubmittingRef.current || loading) {
      return;
    }
    isSubmittingRef.current = true;

    setLoading(true);
    setError('');
    setVideoDiagnostic(null);
    setDiagnosticCopied(false);

    try {
      if (postType === 'video') {
        if (!videoFile) {
          setError('Please choose a video file to publish');
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const tTotalStart = performance.now();

        // Ensure any in-progress Android content:// memory snapshot has completed
        const activeVideoFile = videoPreparePromiseRef.current
          ? await videoPreparePromiseRef.current
          : videoFile;

        let cloudinaryResult: storageService.VideoUploadResult;

        // Reuse already-uploaded Cloudinary result if this exact video file already succeeded
        if (
          uploadedVideoResultRef.current &&
          (uploadedVideoResultRef.current.file === activeVideoFile ||
            uploadedVideoResultRef.current.file === videoFile) &&
          uploadedVideoResultRef.current.result.videoUrl.startsWith('https://')
        ) {
          cloudinaryResult = uploadedVideoResultRef.current.result;
          setUploadProgress(100);
          setUploadPhase('processing');
          setVideoStatusMessage('Saving video reel…');
        } else {
          setUploadPhase('uploading');
          setUploadProgress(0);
          setVideoStatusMessage('Uploading to SogoSocial…');

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          const tUploadStart = performance.now();
          console.info(`[Reel Upload] Upload starting`);

          cloudinaryResult = await storageService.uploadVideo(activeVideoFile, {
            onProgress: (percent) => {
              setUploadProgress(percent);
              if (percent >= 99) {
                setUploadPhase((prev) => (prev === 'retrying' ? prev : 'processing'));
              }
            },
            onStatusChange: (status) => {
              setUploadPhase(status.phase);
              setVideoStatusMessage(status.message);
            },
            signal: abortController.signal,
          });

          const tUploadEnd = performance.now();
          const uploadDurationMs = tUploadEnd - tUploadStart;
          const uploadSpeedMBs =
            uploadDurationMs > 0
              ? (activeVideoFile.size / (1024 * 1024)) / (uploadDurationMs / 1000)
              : 0;
          console.info(
            `[Reel Upload] Cloudinary upload successful: +${uploadDurationMs.toFixed(1)}ms (${uploadSpeedMBs.toFixed(2)} MB/s)`
          );

          if (!cloudinaryResult.videoUrl || !cloudinaryResult.videoUrl.startsWith('https://')) {
            throw new Error('Failed to obtain a valid video URL. Please try again.');
          }

          uploadedVideoResultRef.current = { file: activeVideoFile, result: cloudinaryResult };
        }

        // Parse and normalize tags consistently (strip duplicate #, trim, lowercase, deduplicate)
        const parsedTags = parseNormalizedTags(tagsInput);
        recordUsedTagsInCache(parsedTags);

        // Firestore save started (using deterministic draftIdRef so retries never duplicate the Reel)
        const tFirestoreStart = performance.now();
        console.info(`[Reel Upload] Firestore save starting`);

        await videosService.createVideo(
          {
            userId: currentUser.id,
            user: {
              id: currentUser.id,
              username: currentUser.username,
              displayName: currentUser.displayName,
              avatarUrl: currentUser.avatarUrl,
              isVerified: currentUser.isVerified,
            },
            videoUrl: cloudinaryResult.videoUrl,
            thumbnailUrl: cloudinaryResult.thumbnailUrl,
            caption: caption.trim(),
            tags: parsedTags,
            duration: cloudinaryResult.duration,
            publicId: cloudinaryResult.publicId,
          },
          draftIdRef.current
        );

        const tFirestoreEnd = performance.now();
        const firestoreDuration = (tFirestoreEnd - tFirestoreStart).toFixed(1);
        const tTotalEnd = performance.now();
        const totalDurationMs = tTotalEnd - tTotalStart;
        console.info(
          `[Reel Upload] Firestore save successful (+${firestoreDuration}ms, total=${(totalDurationMs / 1000).toFixed(2)}s)`
        );

        // Success callback
        onCreated('video');
      } else if (postType === 'story') {
        let finalImageUrl = imageUrl;
        if (!finalImageUrl && imageFile) {
          finalImageUrl = await uploadSelectedImageFile(imageFile);
        }

        if (!finalImageUrl || !finalImageUrl.startsWith('https://')) {
          setError('Please provide an image for your story');
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const handedOffLocalPreview = imagePreviewUrl || undefined;
        if (handedOffLocalPreview) {
          // Prevent unmount cleanup from revoking the object URL while it serves as instant 0ms Story circle preview
          imagePreviewUrlRef.current = '';
        }

        await storiesService.createStory(
          {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
          finalImageUrl,
          draftIdRef.current,
          {
            localPreviewUrl: handedOffLocalPreview,
          }
        );
        onCreated('story');
      } else {
        // Feed post
        let finalImageUrl = imageUrl;
        if (!finalImageUrl && imageFile) {
          finalImageUrl = await uploadSelectedImageFile(imageFile);
        }

        if (!finalImageUrl || !finalImageUrl.startsWith('https://')) {
          setError('Please provide an image for your post');
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const parsedTags = parseNormalizedTags(tagsInput);
        recordUsedTagsInCache(parsedTags);

        const trimmedLocation = location.trim();
        const finalLocationData =
          selectedLocationData &&
          trimmedLocation &&
          selectedLocationData.name.toLowerCase() === trimmedLocation.toLowerCase()
            ? selectedLocationData
            : undefined;

        await postsService.createPost(
          {
            userId: currentUser.id,
            user: {
              id: currentUser.id,
              username: currentUser.username,
              displayName: currentUser.displayName,
              avatarUrl: currentUser.avatarUrl,
              isVerified: currentUser.isVerified,
            },
            imageUrl: finalImageUrl,
            caption: caption.trim(),
            tags: parsedTags,
            location: trimmedLocation || undefined,
            locationData: finalLocationData,
          },
          draftIdRef.current
        );
        onCreated('feed');
      }
    } catch (err: unknown) {
      if (err instanceof storageService.VideoUploadError && err.diagnostic) {
        setVideoDiagnostic(err.diagnostic);
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Upload failed. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
      setUploadPhase('idle');
      setVideoStatusMessage('');
      setImageUploadPhase('idle');
      setImageStatusMessage('');
      isSubmittingRef.current = false;
    }
  };

  const hasImageReadyOrSelected = Boolean(imageUrl || imageFile);

  return (
    <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 sm:p-8 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-slate-800 gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">New Publication</h1>
          <p className="text-xs text-slate-400 mt-0.5">Share with the SogoSocial community</p>
        </div>

        {/* Type Toggle: Feed vs Story vs Video */}
        <div className="flex bg-slate-800/90 border border-slate-700/60 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setPostType('feed');
              setError('');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postType === 'feed'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Feed
          </button>
          <button
            type="button"
            onClick={() => {
              setPostType('story');
              setError('');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postType === 'story'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Story
          </button>
          <button
            type="button"
            onClick={() => {
              setPostType('video');
              setError('');
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postType === 'video'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Video Reel</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-950/40 text-rose-300 rounded-xl text-xs font-medium border border-rose-800/60">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setError('');
                setVideoDiagnostic(null);
                setDiagnosticCopied(false);
              }}
              className="text-rose-400 hover:text-rose-200 font-bold ml-2 text-xs shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>

          {videoDiagnostic && (
            <div className="mt-3 pt-3 border-t border-rose-900/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono font-bold text-[11px] text-rose-200 tracking-wide">
                  VIDEO UPLOAD FAILURE DIAGNOSTIC
                </span>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(videoDiagnostic.formattedSummary);
                        setDiagnosticCopied(true);
                        setTimeout(() => setDiagnosticCopied(false), 2500);
                      }
                    } catch {}
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-[10px] font-mono font-bold text-rose-100 transition-colors cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{diagnosticCopied ? 'COPIED!' : 'COPY LOG'}</span>
                </button>
              </div>
              <pre className="p-2.5 bg-black/75 rounded-lg font-mono text-[11px] text-emerald-400 border border-rose-900/40 overflow-x-auto whitespace-pre leading-relaxed select-all">
                {videoDiagnostic.formattedSummary}
              </pre>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* VIDEO UPLOAD SECTION */}
        {postType === 'video' ? (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Video File (Required)
            </label>

            {/* Keep file input mounted so Android WebView does not invalidate the selected content:// File handle */}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/*"
              onChange={handleVideoSelect}
              id="video-file-input"
              className="hidden"
            />

            {videoPreviewUrl ? (
              <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 flex flex-col items-center justify-center p-2">
                <video
                  src={videoPreviewUrl}
                  controls
                  playsInline
                  className="max-h-80 w-auto rounded-xl object-contain bg-black"
                />
                <div className="w-full flex items-center justify-between px-3 py-2 mt-2 bg-slate-950/60 rounded-xl">
                  <span className="text-xs text-slate-300 truncate max-w-[200px]">
                    {videoFile?.name} ({(videoFile ? videoFile.size / (1024 * 1024) : 0).toFixed(1)} MB)
                  </span>
                  <button
                    type="button"
                    onClick={handleClearVideo}
                    disabled={loading}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                  >
                    Change Video
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-800 bg-slate-950/40 rounded-2xl p-6 sm:p-8 text-center hover:border-cyan-500 transition-colors">
                <label
                  htmlFor="video-file-input"
                  className="flex flex-col items-center justify-center cursor-pointer group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-cyan-950/50 text-cyan-400 border border-cyan-800/40 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-lg shadow-cyan-950/20">
                    <Video className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    Select video from device
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    MP4, WebM, QuickTime up to 100MB
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-bold rounded-xl border border-cyan-500/30 transition-colors">
                    <UploadCloud className="w-4 h-4" />
                    Browse Gallery
                  </span>
                </label>
              </div>
            )}

            {/* Upload Progress Bar */}
            {uploadPhase !== 'idle' && (
              <div className="mt-4 p-4 bg-slate-950/80 rounded-2xl border border-cyan-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    {uploadPhase === 'retrying' && (
                      <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    )}
                    <span className={uploadPhase === 'retrying' ? 'text-amber-300' : ''}>
                      {uploadPhase === 'retrying'
                        ? videoStatusMessage || 'Connection interrupted. Retrying...'
                        : uploadPhase === 'uploading'
                        ? `${videoStatusMessage || 'Uploading to SogoSocial…'} ${uploadProgress}%`
                        : videoStatusMessage || 'Processing video…'}
                    </span>
                  </span>
                  <span className="text-cyan-400">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      uploadPhase === 'retrying'
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                        : 'bg-gradient-to-r from-cyan-400 to-blue-500'
                    }`}
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* IMAGE UPLOAD SECTION (Resilient with live progress & automatic retry) */
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Media Asset (Required)
            </label>

            {imageUrl || imagePreviewUrl ? (
              <div className="space-y-3">
                <div className="relative min-h-[220px] max-h-[50vh] rounded-2xl overflow-hidden bg-slate-950 group border border-slate-800 flex items-center justify-center p-2">
                  <img
                    src={imageUrl || imagePreviewUrl}
                    alt="Upload preview"
                    className="w-full h-auto max-h-[48vh] object-contain rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={handleClearImage}
                    disabled={loading}
                    className="absolute top-3 right-3 px-3 py-1.5 bg-black/70 hover:bg-black/90 text-white rounded-full text-xs font-semibold backdrop-blur-xs border border-white/20 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Change Image
                  </button>
                </div>

                {imageUploadPhase !== 'idle' && (
                  <div className="p-3.5 bg-slate-950/80 rounded-2xl border border-cyan-500/30 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span className="flex items-center gap-1.5">
                        {imageUploadPhase === 'retrying' && (
                          <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                        )}
                        <span className={imageUploadPhase === 'retrying' ? 'text-amber-300' : ''}>
                          {imageUploadPhase === 'retrying'
                            ? imageStatusMessage || 'Connection interrupted. Retrying...'
                            : imageUploadPhase === 'uploading'
                            ? `${imageStatusMessage || 'Uploading photo…'} ${imageUploadProgress}%`
                            : imageStatusMessage || 'Finalizing photo…'}
                        </span>
                      </span>
                      <span className="text-cyan-400">{imageUploadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          imageUploadPhase === 'retrying'
                            ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                            : 'bg-gradient-to-r from-cyan-400 to-blue-500'
                        }`}
                        style={{ width: `${imageUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-800 bg-slate-950/40 rounded-2xl p-6 sm:p-8 text-center hover:border-cyan-500 transition-colors">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  id="image-file-input"
                  className="hidden"
                />
                <label
                  htmlFor="image-file-input"
                  className="flex flex-col items-center justify-center cursor-pointer group"
                >
                  <div className="w-12 h-12 rounded-2xl bg-cyan-950/50 text-cyan-400 border border-cyan-800/40 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    Click to upload from device
                  </p>
                  <p className="text-xs text-slate-400 mt-1">PNG, JPG, WebP up to 10MB</p>
                </label>

                {/* Presets for Instant Testing */}
                <div className="mt-6 pt-4 border-t border-slate-800">
                  <p className="text-xs text-slate-400 mb-2 flex items-center justify-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    Or pick a curated sample photo:
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {PRESET_PHOTOS.map((src, idx) => (
                      <img
                        key={idx}
                        src={src}
                        alt="Preset option"
                        onClick={() => {
                          setImageFile(null);
                          setImagePreviewUrl('');
                          setImageUrl(src);
                          setError('');
                          draftIdRef.current = createDraftId(currentUser?.id);
                        }}
                        className="w-12 h-12 rounded-lg object-cover cursor-pointer hover:ring-2 hover:ring-cyan-400 transition-all hover:scale-105"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Caption (for Feed and Video posts) */}
        {postType !== 'story' && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Caption & Description
            </label>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                postType === 'video'
                  ? 'Add a caption for your video reel... #trending #sogosocial'
                  : 'What is the story behind this visual?'
              }
              className="w-full p-3.5 bg-slate-800/60 border border-slate-700/80 rounded-2xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
            />
          </div>
        )}

        {/* Location & Tags (with real-time Autocomplete) */}
        {postType !== 'story' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {postType === 'feed' && (
              <div ref={locationContainerRef} className="relative">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                  Location
                </label>
                <div className="relative">
                  <input
                    ref={locationInputRef}
                    type="text"
                    value={location}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocation(val);
                      if (
                        selectedLocationData &&
                        val.trim().toLowerCase() !== selectedLocationData.name.toLowerCase()
                      ) {
                        setSelectedLocationData(null);
                      }
                    }}
                    onFocus={() => {
                      if (
                        location.trim().length >= 2 &&
                        (locationSuggestions.length > 0 || isLocationLoading || hasSearchedLocation) &&
                        (!selectedLocationData ||
                          selectedLocationData.name.toLowerCase() !== location.trim().toLowerCase())
                      ) {
                        setIsLocationDropdownOpen(true);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsLocationDropdownOpen(false);
                      }
                    }}
                    autoComplete="off"
                    placeholder="e.g. Lahore, Pakistan"
                    className="w-full px-3.5 py-2.5 pr-9 bg-slate-800/60 border border-slate-700/80 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                  {isLocationLoading ? (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 pointer-events-none">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  ) : location ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLocation('');
                        setSelectedLocationData(null);
                        setLocationSuggestions([]);
                        setHasSearchedLocation(false);
                        setIsLocationDropdownOpen(false);
                        locationInputRef.current?.focus();
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 rounded-md cursor-pointer"
                      aria-label="Clear location"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* Location Autocomplete Suggestions Dropdown */}
                {isLocationDropdownOpen && location.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto overscroll-contain divide-y divide-slate-800/80">
                    {isLocationLoading && locationSuggestions.length === 0 ? (
                      <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        <span>Searching locations...</span>
                      </div>
                    ) : locationSuggestions.length > 0 ? (
                      locationSuggestions.map((item) => (
                        <button
                          key={item.placeId || item.name}
                          type="button"
                          onMouseDown={(e) => {
                            // Prevent input blur before selection registers
                            e.preventDefault();
                          }}
                          onClick={() => handleSelectLocationSuggestion(item)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-800/90 active:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-100 truncate">
                              {item.name}
                            </p>
                            {item.subtitle &&
                              item.subtitle.toLowerCase() !== item.name.toLowerCase() && (
                                <p className="text-[11px] text-slate-400 truncate">
                                  {item.subtitle}
                                </p>
                              )}
                          </div>
                        </button>
                      ))
                    ) : hasSearchedLocation && !locationSearchError ? (
                      <div className="px-3.5 py-3 text-xs text-slate-400">
                        No locations found
                      </div>
                    ) : locationSearchError ? (
                      <div className="px-3.5 py-2.5 text-xs text-slate-400">
                        Location suggestions unavailable — your custom location will still be saved.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            <div ref={tagsContainerRef} className="relative">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-cyan-400" />
                Tags
              </label>
              <div className="relative">
                <input
                  ref={tagsInputRef}
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  onFocus={() => {
                    const { activeQuery } = getActiveTagContext(tagsInput);
                    if (
                      activeQuery.length >= 2 &&
                      (tagSuggestions.length > 0 || isTagLoading)
                    ) {
                      setIsTagDropdownOpen(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsTagDropdownOpen(false);
                    }
                  }}
                  autoComplete="off"
                  placeholder="reels, travel, creative"
                  className="w-full px-3.5 py-2.5 pr-8 bg-slate-800/60 border border-slate-700/80 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                />
                {isTagLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 pointer-events-none">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>

              {/* Tag Autocomplete Suggestions Dropdown */}
              {isTagDropdownOpen &&
                getActiveTagContext(tagsInput).activeQuery.length >= 2 &&
                (isTagLoading || tagSuggestions.length > 0) && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto overscroll-contain divide-y divide-slate-800/80">
                    {isTagLoading && tagSuggestions.length === 0 ? (
                      <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        <span>Searching tags...</span>
                      </div>
                    ) : (
                      tagSuggestions.map((item) => (
                        <button
                          key={item.tag}
                          type="button"
                          onMouseDown={(e) => {
                            // Prevent input blur before tag selection registers
                            e.preventDefault();
                          }}
                          onClick={() => handleSelectTagSuggestion(item.tag)}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-800/90 active:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <span className="text-sm font-medium text-cyan-400 truncate">
                            #{item.tag}
                          </span>
                          {item.isFromSogo && item.usageCount > 0 && (
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {item.usageCount} {item.usageCount === 1 ? 'post' : 'posts'}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}

              {/* Normalized Tag Chips Preview with Quick Remove */}
              {getActiveTagContext(tagsInput).completedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {getActiveTagContext(tagsInput).completedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-xs font-medium text-cyan-300"
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCompletedTag(tag)}
                        className="text-cyan-400/70 hover:text-cyan-200 cursor-pointer"
                        aria-label={`Remove #${tag}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          {onCancel && (
            <Button variant="ghost" size="md" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={loading}
            rightIcon={<Check className="w-4 h-4" />}
            disabled={
              postType === 'video'
                ? !videoFile || loading
                : !hasImageReadyOrSelected || loading
            }
          >
            {loading && postType === 'video'
              ? uploadPhase === 'retrying'
                ? 'Connection interrupted. Retrying...'
                : uploadPhase === 'uploading'
                ? `Uploading… ${uploadProgress}%`
                : 'Processing video…'
              : loading && imageUploadPhase !== 'idle'
              ? imageUploadPhase === 'retrying'
                ? 'Connection interrupted. Retrying...'
                : `Uploading… ${imageUploadProgress}%`
              : postType === 'video'
              ? 'Publish Video Reel'
              : postType === 'story'
              ? 'Share Story'
              : 'Publish Post'}
          </Button>
        </div>
      </form>
    </div>
  );
};
