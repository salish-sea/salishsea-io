import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, queryAssignedElements } from "lit/decorators.js";
import { fromLonLat } from "ol/proj.js";
import { Task } from "@lit/task";
import { classMap } from "lit/directives/class-map.js";
import { supabase } from "./supabase.ts";
import { consume } from "@lit/context";
import { userContext, type User } from "./identity.ts";
import { v7 } from "uuid";


@customElement('photo-uploader')
export default class PhotoUploader extends LitElement {
  static styles = css`
    div {
      border: 1px solid yellow;
      box-sizing: border-box;
      height: 100%;
    }
    img {
      height: 100%;
    }
    .error {
      border: 1px solid red;
    }
    .ready {
      border: 1px solid white;
    }
  `;

  @consume({context: userContext, subscribe: true})
  user: User | undefined;

  #uploadTask = new Task(this, {
    args: () => [this.file],
    task: async ([file]) => {
      if (!file)
        return;
      if (!this.user)
        throw new Error("Tried to upload photo before we were signed in!");
      const { id: uid } = this.user;
      const filename = (file.name || v7()).replace(/[^-a-z0-9\._]/gi, '_').toLowerCase();
      const path = `${uid}/${this.sightingId}/${filename}`;
      const {data, error} = await supabase.storage.from('media').upload(path, file, {
        cacheControl: 'max-age=259200',
        upsert: true,
      });
      if (error) {
        throw new Error(`Upload failed: ${error.message}`);
      }
      const {data: {publicUrl}} = supabase.storage.from('media').getPublicUrl(data.path);
      for (const input of this.inputs) {
        input.value = publicUrl;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return publicUrl;
    },
  })

  #thumbnailTask = new Task(this, {
    args: () => [this.file],
    task: ([file]) => {
      if (!file)
        return;
      const fileReader = new FileReader();
      return new Promise<string>((resolve, reject) => {
        fileReader.onload = () => {
          resolve(fileReader.result as string);
        };
        fileReader.onerror = reject;
        fileReader.readAsDataURL(file);
      });
    },
  })

  @property({type: String, reflect: true})
  sightingId!: string

  @property({type: File, attribute: false})
  file: File | undefined

  @query('img', true)
  thumbnail!: HTMLImageElement

  @queryAssignedElements({flatten: true, slot: 'input', selector: 'input'})
  private inputs!: Array<HTMLInputElement>

  protected render(): unknown {
    const classes = {
      error: !!this.#uploadTask.error,
      ready: !!this.#uploadTask.value,
    }
    const imgSrc = this.#thumbnailTask.value || "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    const title = this.#uploadTask.error || (this.#uploadTask.value ? "Uploaded successfully" : "Uploading");
    return html`
      <div class=${classMap(classes)} title=${title}>
        <img src=${imgSrc}>
        <slot name="input"></slot>
      </div>
    `;
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    if (!this.file)
      throw("PhotoUploader.file not set at firstUpdated");

    this.readExif();
  }

  async readExif() {
    const ExifReader = await import('exifreader');
    const {exif, gps} = await ExifReader.load(this.file!, {async: true, expanded: true});

    // signed decimals
    if (gps && gps.Latitude && gps.Longitude) {
      const coords = fromLonLat([gps.Longitude, gps.Latitude]);
      this.dispatchEvent(new CustomEvent('coordinates-detected', {bubbles: true, composed: true, detail: coords}));
    }

    // e.g. '2025:05:09 15:05:20'
    let [date, time] = exif?.DateTime?.value[0]?.split(' ') || [];
    date = date?.replaceAll(':', '-');
    if (date && time) {
      this.dispatchEvent(new CustomEvent('datetime-detected', {bubbles: true, composed: true, detail: `${date} ${time}`}));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "photo-uploader": PhotoUploader;
  }
}
