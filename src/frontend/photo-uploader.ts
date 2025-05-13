import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, queryAssignedElements } from "lit/decorators.js";
import { fromLonLat } from "ol/proj.js";
import { queryStringAppend } from "./util.ts";


@customElement('photo-uploader')
export default class PhotoUploader extends LitElement {
  @property({type: String, reflect: true})
  sightingId!: string

  @property({type: File, attribute: false})
  file!: File

  @property({type: String})
  objectKey: string | undefined

  @queryAssignedElements({flatten: true, slot: 'thumbnail', selector: 'img'})
  thumbnails!: Array<HTMLImageElement>

  @queryAssignedElements({flatten: true, slot: 'input', selector: 'input'})
  inputs!: Array<HTMLInputElement>

  protected render(): unknown {
    return html`
      <slot name="thumbnail"></slot>
      <slot name="input"></slot>
    `;
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    if (!this.file)
      throw("PhotoUploader.file not set at firstUpdated");

    this.readThumbnail();
    this.readExif();
    this.uploadFile();
  }

  readThumbnail() {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      for (const thumbnail of this.thumbnails)
        thumbnail.src = fileReader.result as string
    };
    fileReader.readAsDataURL(this.file);
  }

  async readExif() {
    const ExifReader = await import('exifreader');
    const {exif, gps} = await ExifReader.load(this.file, {async: true, expanded: true});

    // signed decimals
    if (gps && gps.Latitude && gps.Longitude) {
      const coords = fromLonLat([gps.Longitude, gps.Latitude]);
      this.dispatchEvent(new CustomEvent('coordinates-detected', {bubbles: true, composed: true, detail: coords}));
    }

    // e.g. '2025:05:09 15:05:20'
    const datetime = exif?.DateTime?.value[0];
    if (datetime)
      this.dispatchEvent(new CustomEvent('datetime-detected', {bubbles: true, composed: true, detail: datetime}));
  }

  async uploadFile() {
    const endpoint = queryStringAppend(`/api/sightings/${this.sightingId}/uploadUrl`, {
      contentLength: this.file.size,
      contentType: this.file.type,
      fileName: this.file.name,
    });
    const resp = await fetch(endpoint)
    const signedUrl = new URL(await resp.text());
    const signedRequest = new Request(signedUrl, {
      body: this.file,
      headers: {
        'Content-Type': this.file.type,
      },
      method: 'PUT',
    });
    await fetch(signedRequest);
    for (const input of this.inputs) {
      input.value = signedUrl.pathname;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "photo-uploader": PhotoUploader;
  }
}
