import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import { CippIcons } from '../../utils/icon-registry'
import { ApiPostCall } from '../../api/ApiCall'
import CippButtonCard from '../CippCards/CippButtonCard'
import CippFormComponent from './CippFormComponent'
import { CippApiResults } from './CippApiResults'
import { CippDataTable } from '../CippTable/CippDataTable'

/**
 * Purview content search for a BEC case: find the phishing message across mailboxes by sender,
 * subject and date, watch the per-mailbox counts come in, and - for a super admin, after a typed
 * confirmation - soft-delete it through Purview. CIPP only ever sees counts.
 */
export const CippBecContentSearchCard = ({
  tenantFilter,
  caseId,
  becData,
  isSuperAdmin = false,
  defaultSender = '',
}) => {
  const [searchName, setSearchName] = useState('')
  const [status, setStatus] = useState(null)
  const windowDays = becData?.AnalysisWindowDays || 7
  const extractedAt = becData?.ExtractedAt
    ? new Date(becData.ExtractedAt)
    : new Date()
  const startDefault = new Date(
    extractedAt.getTime() - windowDays * 24 * 60 * 60 * 1000
  )

  const formControl = useForm({
    mode: 'onChange',
    defaultValues: {
      Sender: defaultSender,
      Subject: '',
      StartDate: startDefault.toISOString().slice(0, 10),
      EndDate: extractedAt.toISOString().slice(0, 10),
      AllMailboxes: true,
      Locations: '',
      PurgeConfirmation: '',
    },
  })
  const watched = useWatch({ control: formControl.control })

  const createCall = ApiPostCall({ relatedQueryKeys: [] })
  const statusCall = ApiPostCall({ relatedQueryKeys: [] })
  const purgeCall = ApiPostCall({ relatedQueryKeys: [] })
  const removeCall = ApiPostCall({ relatedQueryKeys: [] })

  const locations = () =>
    watched?.AllMailboxes
      ? ['All']
      : String(watched?.Locations || '')
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)

  const handleCreate = () => {
    createCall.mutate(
      {
        url: '/api/ExecBECContentSearch',
        data: {
          tenantFilter,
          Action: 'Create',
          caseId,
          Sender: watched?.Sender,
          Subject: watched?.Subject,
          StartDate: watched?.StartDate,
          EndDate: watched?.EndDate,
          Locations: locations(),
        },
      },
      {
        onSuccess: (result) => {
          const name = result?.data?.Search?.Name
          if (name) {
            setSearchName(name)
            setStatus(null)
          }
        },
      }
    )
  }
  const handleStatus = () => {
    statusCall.mutate(
      {
        url: '/api/ExecBECContentSearch',
        data: { tenantFilter, Action: 'Status', Name: searchName, caseId },
      },
      { onSuccess: (result) => setStatus(result?.data?.Results || null) }
    )
  }
  const handlePurge = () => {
    purgeCall.mutate({
      url: '/api/ExecBECContentSearch',
      data: {
        tenantFilter,
        Action: 'Purge',
        Name: searchName,
        caseId,
        Confirmation: watched?.PurgeConfirmation,
      },
    })
  }
  const handleRemove = () => {
    removeCall.mutate(
      {
        url: '/api/ExecBECContentSearch',
        data: { tenantFilter, Action: 'Remove', Name: searchName, caseId },
      },
      {
        onSuccess: () => {
          setSearchName('')
          setStatus(null)
        },
      }
    )
  }

  const canCreate =
    !!(watched?.Sender || watched?.Subject) &&
    (watched?.AllMailboxes || locations().length > 0)
  const purgeConfirmed = (watched?.PurgeConfirmation || '') === searchName

  return (
    <CippButtonCard
      variant="outlined"
      component="accordion"
      title="Purview content search and purge"
    >
      <Stack spacing={2}>
        <Typography variant="body2">
          Locate the phishing message across mailboxes without anyone reading
          mail: Purview searches on sender, subject and date and reports counts
          per mailbox. A super admin can then soft-delete the found items
          through Purview. CIPP-SAM needs the Purview <em>Compliance Search</em>{' '}
          role (and <em>Search And Purge</em> to purge); the result says so when
          it is missing.
        </Typography>
        <Grid container spacing={1}>
          <Grid size={{ xs: 12, md: 6 }}>
            <CippFormComponent
              type="textField"
              name="Sender"
              label="Sender address"
              formControl={formControl}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <CippFormComponent
              type="textField"
              name="Subject"
              label="Subject contains"
              formControl={formControl}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <CippFormComponent
              type="textField"
              name="StartDate"
              label="Sent on or after (YYYY-MM-DD)"
              formControl={formControl}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <CippFormComponent
              type="textField"
              name="EndDate"
              label="Sent on or before (YYYY-MM-DD)"
              formControl={formControl}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <CippFormComponent
              type="switch"
              name="AllMailboxes"
              label="Search every mailbox"
              formControl={formControl}
            />
            {!watched?.AllMailboxes && (
              <CippFormComponent
                type="textField"
                name="Locations"
                label="Mailboxes (comma-separated addresses)"
                formControl={formControl}
              />
            )}
          </Grid>
        </Grid>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<CippIcons.Search />}
            onClick={handleCreate}
            disabled={!canCreate || createCall.isPending}
          >
            Create and start search
          </Button>
          {searchName && (
            <>
              <Button
                variant="outlined"
                startIcon={<CippIcons.Refresh />}
                onClick={handleStatus}
                disabled={statusCall.isPending}
              >
                Refresh status
              </Button>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<CippIcons.DeleteForever />}
                onClick={handleRemove}
                disabled={removeCall.isPending}
              >
                Remove search
              </Button>
            </>
          )}
        </Stack>
        <CippApiResults apiObject={createCall} />
        <CippApiResults apiObject={removeCall} />
        {searchName && (
          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Chip label={searchName} variant="outlined" />
              {status?.Status && (
                <Chip
                  label={`${status.Status}: ${status.Items ?? 0} item(s) in ${status.LocationsWithHits ?? 0} mailbox(es)`}
                  color={status.Status === 'Completed' ? 'success' : 'default'}
                />
              )}
              {status?.Purge?.Status && (
                <Chip label={`Purge ${status.Purge.Status}`} color="warning" />
              )}
            </Stack>
            <CippApiResults apiObject={statusCall} errorsOnly />
            {status?.Locations?.length > 0 && (
              <CippDataTable
                noCard={true}
                hideTitle={true}
                title="Locations"
                data={status.Locations}
                simpleColumns={['Location', 'ItemCount', 'TotalSize']}
              />
            )}
            {status?.Status === 'Completed' && (
              <Box sx={{ mt: 2 }}>
                {isSuperAdmin ? (
                  <Stack spacing={1}>
                    <Alert severity="warning">
                      Purging soft-deletes every item this search found, in
                      every mailbox it reached. It cannot be undone from CIPP.
                      Type the search name to confirm. Purview removes at most
                      10 items per mailbox per run; repeat until the count
                      reaches zero.
                    </Alert>
                    <Stack direction="row" spacing={1} alignItems="flex-end">
                      <Box sx={{ minWidth: 320 }}>
                        <CippFormComponent
                          type="textField"
                          name="PurgeConfirmation"
                          label={`Type ${searchName} to confirm`}
                          formControl={formControl}
                        />
                      </Box>
                      <Button
                        variant="contained"
                        color="error"
                        startIcon={<CippIcons.DeleteSweep />}
                        onClick={handlePurge}
                        disabled={!purgeConfirmed || purgeCall.isPending}
                      >
                        Purge (soft delete)
                      </Button>
                    </Stack>
                    <CippApiResults apiObject={purgeCall} />
                  </Stack>
                ) : (
                  <Alert severity="info">
                    Purging through Purview requires the super admin role. Ask a
                    super admin to purge search <strong>{searchName}</strong>,
                    or remove the messages from the Purview portal.
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        )}
      </Stack>
    </CippButtonCard>
  )
}

export default CippBecContentSearchCard
