import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, queryAssignedElements } from "lit/decorators.js";
import { fromLonLat } from "ol/proj.js";
import { queryStringAppend } from "./util.ts";
import { Task } from "@lit/task";
import { classMap } from "lit/directives/class-map.js";
import { consume } from "@lit/context";
import { tokenContext } from "./identity.ts";


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

  @consume({context: tokenContext})
  private token: string | undefined;

  #uploadTask = new Task(this, {
    args: () => [this.file],
    task: async ([file]) => {
      if (!file)
        return;
      const endpoint = queryStringAppend(`/api/sightings/${this.sightingId}/uploadUrl`, {
        contentLength: file.size,
        contentType: file.type,
        fileName: file.name,
      });
      const request = new Request(endpoint, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        method: 'GET',
      });
      const resp = await fetch(request)
      if (resp.status !== 200)
        throw `Error authorizing upload: ${resp.statusText}`;
      const signedUrl = new URL(await resp.text());
      const signedRequest = new Request(signedUrl, {
        body: file,
        headers: {
          'Content-Type': file.type,
        },
        method: 'PUT',
      });
      await fetch(signedRequest);
      for (const input of this.inputs) {
        input.value = signedUrl.pathname;
      }
      return signedUrl.pathname;
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
