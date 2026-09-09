import { css, html, LitElement, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Coordinate } from 'ol/coordinate.js';
import { fromLonLat } from 'ol/proj.js';
import { supabase } from './supabase.ts';
import { v7 } from 'uuid';

/**
 * Every photo carries an `id` minted when it joins the list, and it is the only
 * safe way to refer to one.
 *
 * A photo's *identity* survives what happens to it; its position and its object
 * do not. An upload settles into a new object, a removal replaces it with
 * another, and the array is rebuilt from scratch whenever the form is loaded
 * from an observation — so an index captured before an `await`, or an object
 * reference held by a rendered `<photo-attachment>`, can both be pointing at
 * nothing by the time they are used. Both went wrong (bd salish-8q9,
 * salish-jo5), and both failed silently, because `toSpliced` treats a missing
 * index as an instruction rather than a mistake: past the end it appends, and
 * -1 replaces the last element.
 */
type PhotoIdentity = {id: string};
export type UploadingPhoto = PhotoIdentity & {state: 'uploading'; file: File; thumb: string};
export type FailedUploadPhoto = PhotoIdentity & {state: 'failed'; file: File; thumb: string; error: unknown};
export type UploadedPhoto = PhotoIdentity & {state: 'uploaded'; thumb: string; url: string};
export type AttachedPhoto = PhotoIdentity & {state: 'attached'; thumb: string | null; url: string};
export type RemovedPhoto = PhotoIdentity & {state: 'removed'; thumb: string | null};
export type Photo = UploadingPhoto | FailedUploadPhoto | UploadedPhoto | AttachedPhoto | RemovedPhoto;

/** A fresh photo id. Time-ordered, so the list keeps the order they were added. */
export const newPhotoId = (): string => v7();

export async function readExif(file: File) {
  const {load} = await import('exifreader');
  const {exif, gps} = await load(file, {async: true, expanded: true});
  let coordinates: Coordinate | undefined;

  // signed decimals
  if (gps && gps.Latitude && gps.Longitude) {
    coordinates = fromLonLat([gps.Longitude, gps.Latitude]);
  }

  // e.g. '2025:05:09 15:05:20'
  let [date, time] = exif?.DateTime?.value[0]?.split(' ') || [];
  date = date?.replaceAll(':', '-');
  return {coordinates, date, time};
}

export async function photoThumbnail(file: File): Promise<string> {
  const fileReader = new FileReader();
  return new Promise((resolve, reject) => {
    fileReader.onload = () => {
      resolve(fileReader.result as string);
    };
    fileReader.onerror = reject;
    fileReader.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File, sightingId: string): Promise<string> {
  const {data: authData, error: authError} = await supabase().auth.getUser();
  if (authError)
    throw new Error(`Error identifying user during photo upload: ${authError}`);
  const {id: uid} = authData.user;

  const filename = (file.name?.trim() || v7()).replace(/[^-a-z0-9\._]/gi, '_').toLowerCase();
  const path = `${uid}/${sightingId}/${filename}`;

  const {data, error} = await supabase().storage.from('media').upload(path, file, {
    cacheControl: 'max-age=259200',
    upsert: true,
  });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  const {data: {publicUrl}} = supabase().storage.from('media').getPublicUrl(data.path);
  return publicUrl;
}

@customElement('photo-attachment')
export default class PhotoAttachment extends LitElement {
  static styles = css`
    :host {
      box-sizing: border-box;
      position: relative;
    }
    img {
      height: 100%;
    }
    .remove {
      background: transparent;
      border: none;
      padding: 0;
      display: block;
      position: absolute;
      top: 0;
      right: 0;
      height: 44px;
      width: 44px;
      line-height: initial;
    }
    .remove span {
      background: rgba(0,0,0,0.5);
      padding: 2px;
      display: block;
      position: absolute;
      top: 0;
      right: 0;
    }
  `;

  @property({reflect: false})
  photo!: Readonly<Photo>

  protected render(): TemplateResult {
    const thumb = this.photo.thumb || "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    return html`
      <button type="button" class="remove" aria-label="Remove this image" @click=${this.onRemove}><span aria-hidden="true">❌</span></button>
      <img src=${thumb} alt="Photo evidence of subject">
    `;
  }

  private onRemove(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('remove-photo', {bubbles: true, composed: true}));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "photo-attachment": PhotoAttachment;
  }
}
