import { DataChoice } from './DataChoice';

export function StatementImportPanel(props: {
  uploadEnabled: boolean;
  busy: boolean;
  onImportSample: (sampleId: 'all' | 'bank' | 'wechat' | 'alipay') => void;
  onUpload?: (file: File) => void;
}) {
  return <DataChoice {...props} />;
}
