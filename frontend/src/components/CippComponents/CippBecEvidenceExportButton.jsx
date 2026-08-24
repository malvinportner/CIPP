import { useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import { CippIcons } from '../../utils/icon-registry'
import { ApiPostCall } from '../../api/ApiCall'
import { CippApiResults } from './CippApiResults'
import { BECRemediationReportDocument } from '../BECRemediationReportButton'
import { useBrandingSettings } from '../CippPdf/useBrandingSettings'
import { useReportVariables } from '../CippPdf/useReportVariables'

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

const base64ToBlob = (base64, type) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/**
 * Export evidence: renders the PDF report in the browser, posts it to the backend which collates
 * it with the results, the finding CSVs, the containment history and the case's logbook entries
 * into a ZIP with a SHA-256 manifest, and returns the ZIP in the response (base64). Nothing is
 * stored server-side; each export's hash is recorded on the run for later verification.
 */
export const CippBecEvidenceExportButton = ({
  tenantFilter,
  caseId,
  userData,
  becData,
  tenantName,
}) => {
  const brandingSettings = useBrandingSettings()
  const variables = useReportVariables()
  const [busy, setBusy] = useState(false)
  const [lastHash, setLastHash] = useState(becData?.Run?.EvidenceSha256 || null)
  const exportCall = ApiPostCall({
    relatedQueryKeys: [
      `ListBECReports-${tenantFilter}-${userData?.id}`,
      `ListBECReports-${tenantFilter}`,
    ],
  })

  const triggerDownload = (blob) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `BEC_Evidence_${caseId}.zip`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleExport = async () => {
    if (!caseId) return
    setBusy(true)
    let pdfBase64 = ''
    try {
      const { pdf } = await import('@react-pdf/renderer')
      const blob = await pdf(
        <BECRemediationReportDocument
          userData={userData}
          becData={becData}
          brandingSettings={brandingSettings}
          tenantName={tenantName}
          variables={variables}
        />
      ).toBlob()
      pdfBase64 = await blobToBase64(blob)
    } catch (error) {
      // the package is still valuable without the PDF; the backend reports what it bundled
      console.error(
        'BEC evidence: PDF render failed, exporting without it',
        error
      )
    }
    exportCall.mutate(
      {
        url: '/api/ExecBECEvidenceExport',
        data: { tenantFilter, caseId, pdfBase64 },
      },
      {
        onSuccess: (result) => {
          const evidence = result?.data?.Evidence
          setLastHash(evidence?.ZipSha256 || null)
          if (evidence?.ZipBase64) {
            triggerDownload(base64ToBlob(evidence.ZipBase64, 'application/zip'))
          }
          setBusy(false)
        },
        onError: () => setBusy(false),
      }
    )
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="outlined"
          startIcon={<CippIcons.Archive />}
          onClick={handleExport}
          disabled={busy || !caseId}
        >
          {busy ? 'Building evidence package...' : 'Export evidence (ZIP)'}
        </Button>
        {lastHash && (
          <Typography variant="caption" color="text.secondary">
            SHA-256 {lastHash}
          </Typography>
        )}
      </Stack>
      <CippApiResults apiObject={exportCall} />
    </Stack>
  )
}

export default CippBecEvidenceExportButton
