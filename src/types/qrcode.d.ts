declare module "qrcode" {
  interface QRCodeColorOptions {
    dark?: string;
    light?: string;
  }

  interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    color?: QRCodeColorOptions;
  }

  const QRCode: {
    toDataURL(
      text: string,
      options?: QRCodeToDataURLOptions,
    ): Promise<string>;
  };

  export default QRCode;
}
