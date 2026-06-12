import { WidgetType } from "@codemirror/view";

export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "sd-image-widget";
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
