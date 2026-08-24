import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layout as DashboardLayout } from '../../../../../layouts/index'
import { useSettings } from '../../../../../hooks/use-settings'
import { useRouter } from 'next/router'
import { ApiGetCall, ApiPostCall } from '../../../../../api/ApiCall'
import { CippIcons } from '../../../../../utils/icon-registry'
import { HeaderedTabbedLayout } from '../../../../../layouts/HeaderedTabbedLayout'
import tabOptions from './tabOptions'
import { CippUserSwitcher } from '../../../../../components/CippComponents/CippUserSwitcher'
import ReactTimeAgo from 'react-time-ago'
import { CippCopyToClipBoard } from '../../../../../components/CippComponents/CippCopyToClipboard'
import { Box, Stack } from '@mui/system'
import { Grid } from '@mui/system'
import { CippBecRunStatusCard } from '../../../../../components/CippCards/CippBecRunStatusCard'
import CippButtonCard from '../../../../../components/CippCards/CippButtonCard'
import {
  Chip,
  SvgIcon,
  Typography,
  CircularProgress,
  Button,
  Tooltip,
  Alert,
} from '@mui/material'
import { PropertyList } from '../../../../../components/property-list'
import { PropertyListItem } from '../../../../../components/property-list-item'
import { CippHead } from '../../../../../components/CippComponents/CippHead'
import { BECRemediationReportButton } from '../../../../../components/BECRemediationReportButton'
import { CippDataTable } from '../../../../../components/CippTable/CippDataTable'
import { getBecIntuneDeviceActions } from '../../../../../components/CippComponents/CippIntuneDeviceActions.jsx'
import { CippBecContentSearchCard } from '../../../../../components/CippComponents/CippBecContentSearchCard'
import { CippBecPhishingSpreadDialog } from '../../../../../components/CippComponents/CippBecPhishingSpreadDialog'
import { CippApiDialog } from '../../../../../components/CippComponents/CippApiDialog'
import { CippApiResults } from '../../../../../components/CippComponents/CippApiResults'
import { useDialog } from '../../../../../hooks/use-dialog'
import { CippBecEvidenceExportButton } from '../../../../../components/CippComponents/CippBecEvidenceExportButton'

const checkItemSx = { px: 2, py: 0.75 }

const levelColor = (level) =>
  level === 'High'
    ? 'error'
    : level === 'Medium'
      ? 'warning'
      : level === 'Low'
        ? 'success'
        : 'default'

// Completeness marker for one collector: nothing when it saw everything, a chip when it was capped or failed.
const CompletenessChip = ({ marker }) => {
  if (!marker || marker.Complete === true) return null
  const failed = !!marker.Error
  return (
    <Tooltip
      title={
        failed
          ? `This check failed: ${marker.Error}`
          : `This check hit its cap (${marker.Cap}); the data is partial.`
      }
    >
      <Chip
        size="small"
        color={failed ? 'error' : 'warning'}
        label={failed ? 'Failed' : 'Partial'}
      />
    </Tooltip>
  )
}

const BecCheckCard = ({ title, count, completeness, children }) => (
  <CippButtonCard
    variant="outlined"
    component="accordion"
    title={
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="space-between"
        sx={{ width: '100%' }}
      >
        <Box>{title}</Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {(Array.isArray(completeness) ? completeness : [completeness]).map(
            (marker, index) => (
              <CompletenessChip key={index} marker={marker} />
            )
          )}
          {typeof count === 'number' && (
            <Chip
              size="small"
              label={count}
              color={count > 0 ? 'warning' : 'default'}
            />
          )}
        </Stack>
      </Stack>
    }
  >
    {children}
  </CippButtonCard>
)

const joinList = (value) =>
  Array.isArray(value) ? value.join(', ') : (value ?? '')

const Page = () => {
  const userSettingsDefaults = useSettings()
  const router = useRouter()
  const { userId, caseId: caseIdParam } = router.query
  const [initialReady, setInitialReady] = useState(false)
  const [becCheckReady, setBecCheckReady] = useState(false)
  // The run the page shows: picked from the history card / URL, a run started here, else the
  // latest one. Nothing is started by loading the page.
  const [selectedCaseId, setSelectedCaseId] = useState(caseIdParam || null)
  const [startedCaseId, setStartedCaseId] = useState(null)
  const [pollActive, setPollActive] = useState(false)
  const lastFinishedRef = useRef(null)
  const tenant = userSettingsDefaults.currentTenant
  const userRequest = ApiGetCall({
    url: `/api/ListUsers?UserId=${userId}&tenantFilter=${tenant}`,
    queryKey: `ListUsers-${userId}`,
    waiting: initialReady,
  })

  useEffect(() => {
    if (userId) {
      setInitialReady(true)
    }
  }, [userId])

  useEffect(() => {
    if (caseIdParam) setSelectedCaseId(caseIdParam)
  }, [caseIdParam])

  useEffect(() => {
    if (userRequest.isSuccess && userRequest.data?.[0]?.userPrincipalName) {
      setBecCheckReady(true)
    }
  }, [userRequest])

  // The user's run history, newest first. Its top entry is the page's default run.
  const runsCall = ApiGetCall({
    url: '/api/ListBECReports',
    data: { tenantFilter: tenant, userId: userId },
    queryKey: `ListBECReports-${tenant}-${userId}`,
    waiting: becCheckReady,
  })
  const runRows = useMemo(
    () => (Array.isArray(runsCall.data) ? runsCall.data : []),
    [runsCall.data]
  )
  // A failed latest run is still shown (so the failure is visible) unless an older completed
  // or in-progress run exists.
  const latestRun = useMemo(
    () => runRows.find((row) => row.Status !== 'Error') ?? runRows[0] ?? null,
    [runRows]
  )
  const activeCaseId =
    selectedCaseId ?? startedCaseId ?? latestRun?.CaseId ?? null

  // The run itself (GUID keeps the original poll contract). While it is queued or running the
  // response is { Waiting, Progress } and the query polls every 5 seconds.
  const becPollingCall = ApiGetCall({
    url: `/api/execBECCheck`,
    data: { GUID: activeCaseId, tenantFilter: tenant },
    queryKey: `execBECCheck-polling-${activeCaseId}`,
    waiting: !!activeCaseId,
    refetchInterval: pollActive ? 5000 : false,
    staleTime: 0,
  })

  useEffect(() => {
    if (activeCaseId) setPollActive(true)
  }, [activeCaseId])

  useEffect(() => {
    const poll = becPollingCall.data
    if (!poll || !activeCaseId) return
    if (poll.Waiting) {
      setPollActive(true)
      return
    }
    setPollActive(false)
    // once per finished run: refresh the history so its status and score show in the table
    if (lastFinishedRef.current !== activeCaseId) {
      lastFinishedRef.current = activeCaseId
      runsCall.refetch()
    }
  }, [becPollingCall.data, activeCaseId])

  // Starting a run is an explicit POST; the response's GUID becomes the run on screen.
  const startRunCall = ApiPostCall({
    relatedQueryKeys: [`ListBECReports-${tenant}-${userId}`],
  })
  const startRun = () => {
    startRunCall.mutate(
      {
        url: '/api/execBECCheck',
        data: {
          tenantFilter: tenant,
          userid: userId,
          userName: userRequest.data?.[0]?.userPrincipalName,
        },
      },
      {
        onSuccess: (result) => {
          const guid = result?.data?.GUID
          if (!guid) return
          setSelectedCaseId(null)
          setStartedCaseId(guid)
          if (caseIdParam) {
            const { caseId, ...rest } = router.query
            router.replace(
              { pathname: router.pathname, query: rest },
              undefined,
              {
                shallow: true,
              }
            )
          }
        },
      }
    )
  }

  const selectRun = useCallback(
    (caseId) => {
      setSelectedCaseId(caseId)
      router.replace(
        { pathname: router.pathname, query: { ...router.query, caseId } },
        undefined,
        { shallow: true }
      )
    },
    [router]
  )

  const isFetching = userRequest.isLoading
  const poll = becPollingCall.data
  // results only once the run is done; a queued/running/failed run has no checks to show
  const becData = poll && !poll.Waiting && !poll.Error ? poll : null
  const runState =
    !becCheckReady || runsCall.isLoading
      ? 'loading'
      : !activeCaseId
        ? 'none'
        : !poll
          ? 'loading'
          : poll.Waiting
            ? 'waiting'
            : poll.Error
              ? 'error'
              : 'completed'
  const completeness = becData?.Completeness || {}
  const windowDays = becData?.AnalysisWindowDays || 7

  // Helper functions to determine messages
  const getRuleMessage = () => {
    if (!becData) return null
    if (becData.NewRules && becData.NewRules.length > 0) {
      // Example condition to check for potential breach
      const hasPotentialBreach = becData.NewRules.some((rule) =>
        rule.MoveToFolder?.includes('RSS')
      )
      if (hasPotentialBreach) {
        return 'Potential Breach found. The rules for this user contain classic signs of a breach.'
      }
      const recentCount = becData.NewRules.filter(
        (rule) => rule.RecentlyChanged
      ).length
      if (recentCount > 0) {
        return `Rules have been found, ${recentCount} of which were created or changed in the last ${windowDays} days. Please review the list below and take action as needed.`
      }
      return 'Rules have been found. Please review the list below and take action as needed.'
    }
    if (becData.InboxRuleChanges && becData.InboxRuleChanges.length > 0) {
      return `No rules currently exist on the mailbox, but rules were created, changed or removed in the last ${windowDays} days. Please review the changes below.`
    }
    return 'No new rules found.'
  }

  const getUserMessage = () => {
    if (!becData) return null
    if (becData.NewUsers && becData.NewUsers.length > 0) {
      return `New users have been found in the last ${windowDays} days. Please review the list below and take action as needed.`
    }
    return 'No new users found.'
  }

  const getAppMessage = () => {
    if (!becData) return null
    const maliciousAddedCount = (becData.AddedApps || []).filter(
      (app) => app?.MaliciousMatch
    ).length
    const maliciousPresentCount = becData.MaliciousSPs?.length || 0
    if (maliciousAddedCount > 0 || maliciousPresentCount > 0) {
      return `Potential Breach found: ${
        maliciousAddedCount + maliciousPresentCount
      } application(s) in this tenant match the CIPP known-malicious application catalog. Consent-based access survives a password reset, so remove these applications unless their presence is explained.`
    }
    if (becData.AddedApps && becData.AddedApps.length > 0) {
      return 'New applications have been found. Please review the list below and take action as needed.'
    }
    return 'No new applications found.'
  }

  const getMailboxPermissionMessage = () => {
    if (!becData) return null
    const changes = becData.MailboxPermissionChanges || []
    if (changes.length > 0) {
      const targeting = changes.filter((c) => c?.TargetsSuspect === true).length
      if (targeting > 0) {
        return `${changes.length} mailbox permission change(s) found across the tenant in the last ${windowDays} days, ${targeting} of which target this mailbox. Review those first.`
      }
      return `${changes.length} mailbox permission change(s) found across the tenant in the last ${windowDays} days. None appear to target this mailbox, but verify the list below.`
    }
    return 'No mailbox permission changes found.'
  }

  const getSentMessagesMessage = () => {
    if (!becData) return null
    if (becData.SentMessages && becData.SentMessages.length > 0) {
      const analysis = becData.SentMessageAnalysis
      const parts = [
        `${analysis?.TotalMessages ?? becData.SentMessages.length} message(s) to ${
          analysis?.TotalRecipients ?? becData.SentMessages.length
        } recipient(s) were sent in the last ${windowDays} days`,
      ]
      if (analysis?.FlaggedSubjectCount > 0) {
        parts.push(
          `${analysis.FlaggedSubjectCount} subject(s) were sent as many separate messages or to many recipients — identical-subject mass mail is a classic sign of a compromised mailbox running a campaign`
        )
      }
      if (analysis?.Bursts?.length > 0) {
        parts.push(
          `${analysis.Bursts.length} short burst(s) of high-volume sending were detected`
        )
      }
      const foreignCount =
        becData.LocationAnalysis?.ForeignSentMessageCount || 0
      if (foreignCount > 0) {
        parts.push(
          `${foreignCount} message(s) were sent from an IP outside the user's assigned usage location`
        )
      }
      return `${parts.join('. ')}. Please review the list below for any suspicious activity.`
    }
    return 'No sent messages found in the specified time range.'
  }

  const getSafelistMessage = () => {
    if (!becData) return null
    if (becData.SafelistError) {
      return `${becData.SafelistError} An empty list here is not proof the mailbox has none — refresh after fixing the underlying problem.`
    }
    const trustedCount = becData.TrustedSenders?.length || 0
    const blockedCount = becData.BlockedSenders?.length || 0
    const changeCount = becData.SafelistChanges?.length || 0
    if (changeCount > 0) {
      return `Trusted/Blocked senders list was changed ${changeCount} time(s) in the last ${windowDays} days. Please review the changes below.`
    }
    if (trustedCount > 0 || blockedCount > 0) {
      return `${trustedCount} trusted and ${blockedCount} blocked sender/domain entries found. Please review the list below.`
    }
    return 'No trusted or blocked senders/domains found.'
  }

  const formatSafelistValue = (value) => {
    if (!value) return 'unchanged'
    return Array.isArray(value)
      ? value.join(', ') || 'unchanged'
      : String(value)
  }

  // ponytail: stable identity matters — a new array each render would loop CippDataTable's data-sync effect
  const senderRows = useMemo(
    () => [
      ...(becData?.TrustedSenders || []).map((s) => ({
        Sender: s,
        Type: 'Trusted',
      })),
      ...(becData?.BlockedSenders || []).map((s) => ({
        Sender: s,
        Type: 'Blocked',
      })),
    ],
    [becData]
  )

  // the analysis window before the data was extracted. Shared by the Intune
  // enrollment and MFA registration recency checks.
  const analysisWindowStart = useMemo(() => {
    const extractedAt = becData?.ExtractedAt
      ? new Date(becData.ExtractedAt)
      : new Date()
    if (Number.isNaN(extractedAt.getTime())) {
      return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    }
    return new Date(extractedAt.getTime() - windowDays * 24 * 60 * 60 * 1000)
  }, [becData?.ExtractedAt, windowDays])

  const recentMfaDeviceCount = useMemo(
    () =>
      (becData?.MFADevices || []).filter((method) => {
        if (!method?.createdDateTime) return false
        const created = new Date(method.createdDateTime)
        if (Number.isNaN(created.getTime())) return false
        return created >= analysisWindowStart
      }).length,
    [becData?.MFADevices, analysisWindowStart]
  )

  const foreignActivityCount = useMemo(() => {
    const analysis = becData?.LocationAnalysis
    if (!analysis) return 0
    return (
      (analysis.ForeignSignInCount || 0) +
      (analysis.ForeignRuleChangeCount || 0) +
      (analysis.ForeignSafelistChangeCount || 0) +
      (analysis.ForeignSharingChangeCount || 0) +
      (analysis.ForeignSentMessageCount || 0)
    )
  }, [becData?.LocationAnalysis])

  const intuneDevices = useMemo(() => {
    const devices = [...(becData?.IntuneDevices || [])]
    devices.sort((a, b) => {
      const aTime = a?.enrolledDateTime
        ? new Date(a.enrolledDateTime).getTime()
        : 0
      const bTime = b?.enrolledDateTime
        ? new Date(b.enrolledDateTime).getTime()
        : 0
      return bTime - aTime
    })
    return devices
  }, [becData?.IntuneDevices])

  const recentIntuneDeviceCount = useMemo(
    () =>
      intuneDevices.filter((device) => {
        if (!device?.enrolledDateTime) return false
        const enrolled = new Date(device.enrolledDateTime)
        if (Number.isNaN(enrolled.getTime())) return false
        return enrolled >= analysisWindowStart
      }).length,
    [intuneDevices, analysisWindowStart]
  )

  const intuneDeviceActions = useMemo(
    () =>
      getBecIntuneDeviceActions({
        tenantFilter: userSettingsDefaults.currentTenant,
      }),
    [userSettingsDefaults.currentTenant]
  )

  // Full-scope rows, pre-flattened so the tables never receive nested objects
  const delegationRows = useMemo(
    () => becData?.Delegations || [],
    [becData?.Delegations]
  )
  const grantRows = useMemo(
    () =>
      (becData?.UserGrants || []).map((grant) => ({
        ...grant,
        HighRiskScopes: joinList(grant.HighRiskScopes),
        CatalogMatch: grant.CatalogMatch?.Name
          ? `${grant.CatalogMatch.Name} (${grant.CatalogMatch.Source})`
          : '',
      })),
    [becData?.UserGrants]
  )
  const transportChangeRows = useMemo(
    () =>
      (becData?.TransportRuleChanges || []).map((change) => ({
        ...change,
        RiskyParameters: joinList(change.RiskyParameters),
      })),
    [becData?.TransportRuleChanges]
  )
  const transportFlaggedRows = useMemo(
    () =>
      (becData?.TransportRulesFlagged || []).map((rule) => ({
        ...rule,
        RiskReasons: joinList(rule.RiskReasons),
      })),
    [becData?.TransportRulesFlagged]
  )
  const addInRows = useMemo(
    () => becData?.MailboxAddIns || [],
    [becData?.MailboxAddIns]
  )
  const receivedRows = useMemo(
    () => becData?.ReceivedMailFindings || [],
    [becData?.ReceivedMailFindings]
  )
  const defenderRows = useMemo(
    () =>
      (becData?.DefenderDetections || []).map((row) => ({
        ...row,
        ThreatTypes: joinList(row.ThreatTypes),
        DetectionMethods: joinList(row.DetectionMethods),
      })),
    [becData?.DefenderDetections]
  )
  const directoryAuditRows = useMemo(
    () => becData?.DirectoryAudits || [],
    [becData?.DirectoryAudits]
  )
  const registeredDeviceRows = useMemo(
    () => becData?.RegisteredDevices || [],
    [becData?.RegisteredDevices]
  )
  const nonInteractiveRows = useMemo(
    () => becData?.NonInteractiveSignIns || [],
    [becData?.NonInteractiveSignIns]
  )
  const mailActivityRows = useMemo(
    () => becData?.MailActivity || [],
    [becData?.MailActivity]
  )
  const riskDetectionRows = useMemo(
    () => becData?.RiskState?.Detections || [],
    [becData?.RiskState]
  )
  const appliedSignals = useMemo(
    () => (becData?.Score?.Breakdown || []).filter((signal) => signal.Applied),
    [becData?.Score]
  )

  // Containment catalog (for the super-admin flag the Purview purge needs) and the shortcuts
  const actionsCatalog = ApiGetCall({
    url: '/api/ListBECRemediationActions',
    queryKey: 'ListBECRemediationActions',
  })
  const [spreadOpen, setSpreadOpen] = useState(false)
  const [spreadSender, setSpreadSender] = useState('')
  const dismissRiskDialog = useDialog()
  const receivedMailActions = useMemo(
    () => [
      {
        label: 'Block sender (Tenant Allow/Block List)',
        type: 'POST',
        url: '/api/AddTenantAllowBlockList',
        data: {
          tenantID: `!${userSettingsDefaults.currentTenant}`,
          entries: 'SenderAddress',
          listType: '!Sender',
          listMethod: '!Block',
          notes: `!Blocked from BEC case ${becData?.CaseId || ''}`,
          NoExpiration: true,
        },
        confirmText:
          'Block [SenderAddress] tenant-wide in the Tenant Allow/Block List?',
        multiPost: false,
      },
      {
        label: 'Block sender domain (Tenant Allow/Block List)',
        type: 'POST',
        url: '/api/AddTenantAllowBlockList',
        data: {
          tenantID: `!${userSettingsDefaults.currentTenant}`,
          entries: 'SenderDomain',
          listType: '!Sender',
          listMethod: '!Block',
          notes: `!Blocked from BEC case ${becData?.CaseId || ''}`,
          NoExpiration: true,
        },
        confirmText:
          'Block the whole domain [SenderDomain] tenant-wide in the Tenant Allow/Block List?',
        multiPost: false,
      },
      {
        label: 'Who else received mail from this sender?',
        noConfirm: true,
        customFunction: (row) => {
          setSpreadSender(row.SenderAddress || '')
          setSpreadOpen(true)
        },
      },
    ],
    [userSettingsDefaults.currentTenant, becData?.CaseId]
  )

  const runActions = useMemo(
    () => [
      {
        label: 'View this run',
        icon: <CippIcons.Visibility />,
        noConfirm: true,
        customFunction: (row) => selectRun(row.CaseId),
      },
      {
        label: 'Delete run',
        icon: <CippIcons.DeleteForever />,
        type: 'POST',
        url: '/api/ExecBECReport',
        data: { Action: '!Delete', caseId: 'CaseId', tenantFilter: 'Tenant' },
        confirmText:
          'Delete run [CaseId] permanently, including its results and evidence package?',
        relatedQueryKeys: [
          `ListBECReports-${userSettingsDefaults.currentTenant}-${userId}`,
        ],
      },
    ],
    [userSettingsDefaults.currentTenant, userId, selectRun]
  )

  const getMfaMessage = () => {
    if (!becData) return null
    const count = becData.MFADevices?.length || 0
    if (count === 0) {
      return 'No MFA methods are registered for this user. If MFA was expected, an attacker may have removed it; either way the account currently has no second factor.'
    }
    if (recentMfaDeviceCount > 0) {
      return `${count} MFA method(s) registered, ${recentMfaDeviceCount} in the last ${windowDays} days. Verify the recent registrations were made by the user — attackers register their own method to keep access after a password reset.`
    }
    return `${count} MFA method(s) registered. Please review the list below and take action as required.`
  }

  const getSignInLocationMessage = () => {
    if (!becData) return null
    if (becData.SuspectUserSignInsError) {
      return `${becData.SuspectUserSignInsError} This is not proof the user has no sign-ins — fix the underlying permission or licensing problem and refresh.`
    }
    const analysis = becData.LocationAnalysis
    const signInCount = becData.SuspectUserSignIns?.length || 0
    if (signInCount === 0) {
      return 'No sign-ins were found for this user in the sign-in logs.'
    }
    const countries = (analysis?.SignInCountries || [])
      .map((c) => `${c.Country} (${c.Count})`)
      .join(', ')
    if (!analysis?.UsageLocation) {
      return `${
        analysis?.Note ||
        'The user has no usage location assigned in Entra ID, so activity cannot be compared against an expected country.'
      } Sign-in countries seen: ${countries || 'none recorded'}.`
    }
    const foreignParts = []
    if (analysis.ForeignSignInCount > 0) {
      foreignParts.push(
        `${analysis.ForeignSignInCount} sign-in(s), of which ${
          analysis.ForeignSuccessfulSignInCount || 0
        } succeeded (failed foreign attempts are mostly password-spray noise)`
      )
    }
    if (analysis.ForeignRuleChangeCount > 0) {
      foreignParts.push(
        `${analysis.ForeignRuleChangeCount} inbox rule change(s)`
      )
    }
    if (analysis.ForeignSafelistChangeCount > 0) {
      foreignParts.push(
        `${analysis.ForeignSafelistChangeCount} safelist change(s)`
      )
    }
    if (analysis.ForeignSharingChangeCount > 0) {
      foreignParts.push(
        `${analysis.ForeignSharingChangeCount} sharing change(s)`
      )
    }
    if (analysis.ForeignSentMessageCount > 0) {
      foreignParts.push(`${analysis.ForeignSentMessageCount} sent message(s)`)
    }
    if (foreignParts.length > 0) {
      return `The user's assigned usage location is ${
        analysis.UsageLocation
      }, but activity originated outside it: ${foreignParts.join(
        ', '
      )}. Sign-in countries seen: ${countries}. Review the sign-ins below and the flagged rows in the checks above.`
    }
    return `All located activity matches the user's assigned usage location (${
      analysis.UsageLocation
    }). Sign-in countries seen: ${countries || 'none recorded'}.`
  }

  const getSharingMessage = () => {
    if (!becData) return null
    const changes = becData.SharingChanges || []
    if (changes.length === 0) {
      return `No sharing links were created or changed by this account in the last ${windowDays} days.`
    }
    const anonymousCount = changes.filter((c) =>
      c?.Operation?.startsWith('AnonymousLink')
    ).length
    const foreignCount =
      becData.LocationAnalysis?.ForeignSharingChangeCount || 0
    const parts = [
      `${changes.length} OneDrive/SharePoint sharing change(s) found in the last ${windowDays} days`,
    ]
    if (anonymousCount > 0) {
      parts.push(
        `${anonymousCount} involve anonymous links, which anyone with the URL can open`
      )
    }
    if (foreignCount > 0) {
      parts.push(
        `${foreignCount} were made from outside the user's usage location`
      )
    }
    return `${parts.join(
      '. '
    )}. Attackers share folders to keep pulling data after a password reset — review each link and remove any that are not explained.`
  }

  const getIntuneDevicesMessage = () => {
    if (!becData) return null
    if (becData.IntuneDevicesError) {
      return `Could not retrieve Intune-managed devices: ${becData.IntuneDevicesError}. This is not proof that the user has no devices — refresh after fixing permissions or licensing, or check Endpoint → MEM → Devices.`
    }
    if (intuneDevices.length === 0) {
      return 'No Intune-managed devices found for this user.'
    }
    if (recentIntuneDeviceCount > 0) {
      return `${intuneDevices.length} Intune-managed device(s) found for this user, ${recentIntuneDeviceCount} enrolled in the last ${windowDays} days. Prioritize review of recent enrollments (new VM, BYOD, or Windows Hello persistence risk). Retire or factory-wipe from the row actions if needed (requires MEM write permission). Refresh Data after actions to update this list.`
    }
    return `${intuneDevices.length} Intune-managed device(s) found for this user. None were enrolled in the last ${windowDays} days. Review the list below and take action as needed. Retire or factory-wipe from the row actions if needed (requires MEM write permission). Refresh Data after actions to update this list.`
  }

  const mailboxState = becData?.MailboxState
  const flaggedDelegations = delegationRows.filter((d) => d.Flagged).length
  const flaggedGrants = grantRows.filter((g) => g.Flagged).length
  const flaggedTransportChanges = transportChangeRows.filter(
    (c) => c.Flagged
  ).length
  const flaggedAddIns = addInRows.filter((a) => a.Flagged).length
  const typosquatCount = receivedRows.filter(
    (f) => f.FindingType === 'PossibleTyposquat'
  ).length
  const deliveredThreats = defenderRows.filter((d) => d.Delivered).length
  const flaggedAudits = directoryAuditRows.filter((a) => a.Flagged).length
  const recentRegisteredDevices = registeredDeviceRows.filter(
    (d) => d.RegisteredInWindow
  ).length
  const foreignNonInteractive = nonInteractiveRows.filter(
    (s) => s.ForeignLocation === true && s.Status === 'Success'
  ).length
  const riskState = becData?.RiskState

  const subtitle = userRequest.isSuccess
    ? [
        {
          icon: <CippIcons.Mail />,
          text: (
            <CippCopyToClipBoard
              type="chip"
              text={userRequest.data?.[0]?.userPrincipalName}
            />
          ),
        },
        {
          icon: <CippIcons.Fingerprint />,
          text: (
            <CippCopyToClipBoard type="chip" text={userRequest.data?.[0]?.id} />
          ),
        },
        {
          icon: <CippIcons.CalendarIcon />,
          text: (
            <>
              Created:{' '}
              <ReactTimeAgo
                date={new Date(userRequest.data?.[0]?.createdDateTime)}
              />
            </>
          ),
        },
        {
          icon: <CippIcons.Launch />,
          text: (
            <Button
              color="muted"
              style={{ paddingLeft: 0 }}
              size="small"
              href={`https://entra.microsoft.com/${userSettingsDefaults.currentTenant}/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${userId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View in Entra
            </Button>
          ),
        },
      ]
    : []

  const runHistoryCard = (
    <BecCheckCard title="Run history" count={runRows.length}>
      <Typography variant="body2" gutterBottom>
        Every analysis is kept. Select a past run to view it, or generate its
        report and evidence from the BEC reports page. Deleting a run removes
        its results and evidence permanently.
      </Typography>
      {runRows.length > 0 && (
        <Box mt={2}>
          <CippDataTable
            noCard={true}
            hideTitle={true}
            title="BEC runs"
            data={runRows}
            simpleColumns={[
              'ExtractedAt',
              'Scope',
              'Status',
              'Level',
              'Score',
              'RequestedBy',
              'CaseId',
            ]}
            actions={runActions}
          />
        </Box>
      )}
    </BecCheckCard>
  )

  return (
    <HeaderedTabbedLayout
      tabOptions={tabOptions}
      title={userRequest.isSuccess ? userRequest.data?.[0]?.displayName : ''}
      titleControl={
        <CippUserSwitcher
          title={
            userRequest.isSuccess ? userRequest.data?.[0]?.displayName : ''
          }
          currentUserId={userId}
          tenantFilter={userSettingsDefaults.currentTenant}
        />
      }
      subtitle={subtitle}
      isFetching={userRequest.isFetching}
    >
      <CippHead title="Compromise Remediation" />
      {!isFetching && userRequest.isSuccess && (
        <Box
          sx={{
            flexGrow: 1,
            py: 4,
          }}
        >
          <Grid container spacing={2}>
            {/* Status: what the page shows and what is happening to it */}
            <Grid size={{ xs: 12, lg: 5 }}>
              <Stack spacing={3}>
                <CippBecRunStatusCard
                  userPrincipalName={userRequest.data[0].userPrincipalName}
                  userId={userRequest.data[0].id}
                  tenantFilter={userSettingsDefaults.currentTenant}
                  state={runState}
                  caseId={activeCaseId}
                  scope={becData?.Scope ?? poll?.Scope ?? latestRun?.Scope}
                  poll={poll}
                  becData={becData}
                  onStart={startRun}
                  startPending={startRunCall.isPending}
                  windowDays={windowDays}
                />
                <CippApiResults apiObject={startRunCall} errorsOnly={true} />
                {becData?.Score && (
                  <CippButtonCard
                    variant="outlined"
                    title={
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <Box>Threat assessment</Box>
                        <Chip
                          color={levelColor(becData.Score.Level)}
                          label={`${becData.Score.Level} (${becData.Score.Value})`}
                        />
                      </Stack>
                    }
                  >
                    <Typography variant="body2" gutterBottom>
                      Additive score over {becData.Score.Breakdown?.length || 0}{' '}
                      signals: {appliedSignals.length} fired. High from{' '}
                      {becData.Score.Thresholds?.High}, Medium from{' '}
                      {becData.Score.Thresholds?.Medium}. The same score is used
                      in the PDF report and by the API. A score is a prompt to
                      look, not a verdict.
                    </Typography>
                    {appliedSignals.length > 0 && (
                      <PropertyList>
                        {appliedSignals.map((signal) => (
                          <PropertyListItem
                            key={signal.Signal}
                            sx={checkItemSx}
                            label={`+${signal.Weight} ${signal.Description}`}
                            value={`${signal.Count} found`}
                          />
                        ))}
                      </PropertyList>
                    )}
                  </CippButtonCard>
                )}
              </Stack>
            </Grid>
            {/* History, then the checks of the run on screen */}
            <Grid size={{ xs: 12, lg: 7 }}>
              <Stack spacing={3}>
                {runHistoryCard}
                {becData && (
                  <>
                    <BecCheckCard title="Log information">
                      <Typography variant="body2" gutterBottom>
                        {becData?.ExtractResult}. The data of this log was
                        extracted at{' '}
                        {new Date(becData?.ExtractedAt).toLocaleString()}
                        {becData?.CaseId
                          ? ` (case ${becData.CaseId}, ${becData.Scope === 'Full' ? 'full investigation' : 'quick check'})`
                          : ''}
                        . Every run is kept - use the run history to revisit an
                        earlier one, or start a new run from the status card.
                        Only metadata was collected: audit records, sign-ins,
                        trace headers, permissions, rules and devices - no
                        message content.
                      </Typography>
                      {Object.values(completeness).some(
                        (marker) => marker && marker.Complete === false
                      ) && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          {Object.entries(completeness)
                            .filter(
                              ([, marker]) =>
                                marker && marker.Complete === false
                            )
                            .map(
                              ([name, marker]) =>
                                `${name}: ${marker.Error || `capped at ${marker.Cap}`}`
                            )
                            .join(' | ')}
                        </Alert>
                      )}
                    </BecCheckCard>
                    {/* Check 1: Recently added rules */}
                    <BecCheckCard
                      title="Check 1: Mailbox Rules"
                      count={
                        (becData?.NewRules?.length || 0) +
                        (becData?.InboxRuleChanges?.length || 0)
                      }
                      completeness={[
                        completeness.InboxRules,
                        completeness.InboxRuleChanges,
                      ]}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getRuleMessage()}
                      </Typography>
                      {becData?.NewRules?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {[...becData.NewRules]
                              .sort(
                                (a, b) =>
                                  (b?.RecentlyChanged === true) -
                                  (a?.RecentlyChanged === true)
                              )
                              .map((rule, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={`${rule?.Name}${
                                    rule?.RecentlyChanged
                                      ? ` - changed in last ${windowDays} days`
                                      : ''
                                  }${rule?.RiskReasons?.length ? ` - ${rule.RiskReasons.join(', ')}` : ''}`}
                                  value={rule?.Description}
                                />
                              ))}
                          </PropertyList>
                        </Box>
                      )}
                      {becData?.InboxRuleChanges?.length > 0 && (
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Rule changes in the last {windowDays} days
                          </Typography>
                          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                            <PropertyList>
                              {becData.InboxRuleChanges.map((change, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={`${change?.Operation} - ${change?.RuleName}${
                                    change?.ForeignLocation === true
                                      ? ' - outside usage location'
                                      : ''
                                  }`}
                                  value={`${change?.Date} by ${change?.UserKey}${
                                    change?.ClientIP
                                      ? ` from ${change.ClientIP}${
                                          change?.Country
                                            ? ` (${change.Country})`
                                            : ''
                                        }`
                                      : ''
                                  }${change?.Parameters ? ` | ${change.Parameters}` : ''}`}
                                />
                              ))}
                            </PropertyList>
                          </Box>
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 2: Recently added users */}
                    <BecCheckCard
                      title="Check 2: Recently added users"
                      count={becData?.NewUsers?.length || 0}
                      completeness={completeness.TenantUsers}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getUserMessage()}
                      </Typography>
                      {becData?.NewUsers?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {becData.NewUsers.map((user, index) => (
                              <PropertyListItem
                                key={index}
                                sx={checkItemSx}
                                align="horizontal"
                                label={user?.userPrincipalName}
                                value={user?.createdDateTime}
                              />
                            ))}
                          </PropertyList>
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 3: New Applications */}
                    <BecCheckCard
                      title="Check 3: New Applications"
                      count={
                        (becData?.AddedApps?.length || 0) +
                        (becData?.MaliciousSPs?.length || 0)
                      }
                      completeness={completeness.NewApps}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getAppMessage()}
                      </Typography>
                      {becData?.AddedApps?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {[...becData.AddedApps]
                              .sort(
                                (a, b) =>
                                  !!b?.MaliciousMatch - !!a?.MaliciousMatch
                              )
                              .map((app, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={
                                    app?.MaliciousMatch
                                      ? `${app?.displayName} - ${app?.appId} - matches known-malicious catalog entry "${app.MaliciousMatch.Name}"`
                                      : `${app?.displayName} - ${app?.appId}`
                                  }
                                  value={
                                    app?.MaliciousMatch?.Categories?.length
                                      ? `${app?.createdDateTime} | ${app.MaliciousMatch.Categories.join(', ')}`
                                      : app?.createdDateTime
                                  }
                                />
                              ))}
                          </PropertyList>
                        </Box>
                      )}
                      {becData?.MaliciousSPs?.length > 0 && (
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Known-malicious applications present in the tenant
                            (any age)
                          </Typography>
                          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                            <PropertyList>
                              {becData.MaliciousSPs.map((app, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={`${app?.displayName} - ${app?.appId}`}
                                  value={`Catalog: ${app?.CatalogName}${
                                    app?.Categories?.length
                                      ? ` (${app.Categories.join(', ')})`
                                      : ''
                                  } | Enabled: ${app?.accountEnabled} | Added: ${app?.createdDateTime}`}
                                />
                              ))}
                            </PropertyList>
                          </Box>
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 4: Mailbox permission changes */}
                    <BecCheckCard
                      title="Check 4: Mailbox permission changes"
                      count={becData?.MailboxPermissionChanges?.length || 0}
                      completeness={completeness.AuditLog}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getMailboxPermissionMessage()}
                      </Typography>
                      {becData?.MailboxPermissionChanges?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {[...becData.MailboxPermissionChanges]
                              .sort(
                                (a, b) =>
                                  (b?.TargetsSuspect === true) -
                                  (a?.TargetsSuspect === true)
                              )
                              .map((permission, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={
                                    permission?.TargetsSuspect === true
                                      ? `${permission.UserKey} - targets this mailbox${
                                          permission?.ForeignLocation === true
                                            ? ' - outside usage location'
                                            : ''
                                        }`
                                      : permission.UserKey
                                  }
                                  value={`${permission.Operation} - ${permission.Permissions}${
                                    permission?.ClientIP
                                      ? ` | from ${permission.ClientIP}${
                                          permission?.Country
                                            ? ` (${permission.Country})`
                                            : ''
                                        }`
                                      : ''
                                  }`}
                                />
                              ))}
                          </PropertyList>
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 5: Sent Messages */}
                    <BecCheckCard
                      title="Check 5: Sent Messages"
                      count={becData?.SentMessages?.length || 0}
                      completeness={completeness.SentMessages}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getSentMessagesMessage()}
                      </Typography>
                      {becData?.SentMessageAnalysis?.RepeatedSubjects?.length >
                        0 && (
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Repeated subjects
                          </Typography>
                          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                            <PropertyList>
                              {becData.SentMessageAnalysis.RepeatedSubjects.map(
                                (group, index) => (
                                  <PropertyListItem
                                    key={index}
                                    sx={checkItemSx}
                                    label={
                                      group?.Flagged
                                        ? `${group?.Subject} - possible campaign`
                                        : group?.Subject
                                    }
                                    value={`${group?.MessageCount} message(s) to ${group?.RecipientCount} recipient(s) between ${group?.FirstSent} and ${group?.LastSent}`}
                                  />
                                )
                              )}
                            </PropertyList>
                          </Box>
                        </Box>
                      )}
                      {becData?.SentMessageAnalysis?.Bursts?.length > 0 && (
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Send bursts
                          </Typography>
                          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                            <PropertyList>
                              {becData.SentMessageAnalysis.Bursts.map(
                                (burst, index) => (
                                  <PropertyListItem
                                    key={index}
                                    sx={checkItemSx}
                                    label={`${burst?.MessageCount} message(s) to ${burst?.RecipientCount} recipient(s) within ${burst?.WindowMinutes} minutes`}
                                    value={`Starting ${burst?.WindowStart}${
                                      burst?.TopSubject
                                        ? ` | Most common subject: ${burst.TopSubject}`
                                        : ''
                                    }`}
                                  />
                                )
                              )}
                            </PropertyList>
                          </Box>
                        </Box>
                      )}
                      {becData?.SentMessages?.length > 0 && (
                        <Box mt={2}>
                          <CippDataTable
                            noCard={true}
                            hideTitle={true}
                            title="Sent Messages"
                            data={becData.SentMessages}
                            simpleColumns={[
                              'Subject',
                              'RecipientAddress',
                              'Status',
                              'Received',
                              'FromIP',
                              'Country',
                            ]}
                          />
                        </Box>
                      )}
                    </BecCheckCard>

                    <BecCheckCard
                      title="Check 6: MFA Devices"
                      count={becData?.MFADevices?.length || 0}
                      completeness={completeness.MFAMethods}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getMfaMessage()}
                      </Typography>
                      {becData?.MFADevices?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {[...becData.MFADevices]
                              .sort(
                                (a, b) =>
                                  new Date(b?.createdDateTime || 0) -
                                  new Date(a?.createdDateTime || 0)
                              )
                              .map((method, index) => {
                                const isRecent =
                                  method?.createdDateTime &&
                                  new Date(method.createdDateTime) >=
                                    analysisWindowStart
                                return (
                                  <PropertyListItem
                                    key={index}
                                    sx={checkItemSx}
                                    align="horizontal"
                                    label={
                                      isRecent
                                        ? `${method['@odata.type']} - registered in last ${windowDays} days`
                                        : method['@odata.type']
                                    }
                                    value={`${method?.displayName} - Registered at ${method?.createdDateTime}`}
                                  />
                                )
                              })}
                          </PropertyList>
                        </Box>
                      )}
                    </BecCheckCard>

                    <BecCheckCard
                      title="Check 7: Password Changes"
                      count={becData?.ChangedPasswords?.length || 0}
                      completeness={completeness.TenantUsers}
                    >
                      <Typography variant="body2" gutterBottom>
                        Latest password changes for the tenant can be seen below
                      </Typography>
                      {becData?.ChangedPasswords?.length > 0 && (
                        <Box mt={2} sx={{ maxHeight: 300, overflowY: 'auto' }}>
                          <PropertyList>
                            {becData.ChangedPasswords.map(
                              (permission, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label={permission?.displayName}
                                  value={`${permission?.lastPasswordChangeDateTime}`}
                                />
                              )
                            )}
                          </PropertyList>
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 8: Trusted & Blocked Senders */}
                    <BecCheckCard
                      title="Check 8: Trusted & Blocked Senders"
                      count={
                        becData?.SafelistError
                          ? undefined
                          : (becData?.TrustedSenders?.length || 0) +
                            (becData?.BlockedSenders?.length || 0) +
                            (becData?.SafelistChanges?.length || 0)
                      }
                      completeness={[
                        completeness.Safelists,
                        completeness.SafelistChanges,
                      ]}
                    >
                      <Typography
                        variant="body2"
                        gutterBottom
                        color={becData?.SafelistError ? 'error' : 'inherit'}
                      >
                        {getSafelistMessage()}
                      </Typography>
                      {senderRows.length > 0 && (
                        <Box mt={2}>
                          <CippDataTable
                            noCard={true}
                            hideTitle={true}
                            title="Trusted & Blocked Senders"
                            data={senderRows}
                            simpleColumns={['Sender', 'Type']}
                          />
                        </Box>
                      )}
                      {becData?.SafelistChanges?.length > 0 && (
                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Changes in the last {windowDays} days
                          </Typography>
                          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                            <PropertyList>
                              {becData.SafelistChanges.map((change, index) => (
                                <PropertyListItem
                                  key={index}
                                  sx={checkItemSx}
                                  label={`${change?.Operation} by ${change?.UserKey}${
                                    change?.ForeignLocation === true
                                      ? ' - outside usage location'
                                      : ''
                                  }`}
                                  value={`${change?.Date}${
                                    change?.ClientIP
                                      ? ` from ${change.ClientIP}${
                                          change?.Country
                                            ? ` (${change.Country})`
                                            : ''
                                        }`
                                      : ''
                                  } | Trusted: ${formatSafelistValue(
                                    change?.Trusted
                                  )} | Blocked: ${formatSafelistValue(change?.Blocked)}`}
                                />
                              ))}
                            </PropertyList>
                          </Box>
                        </Box>
                      )}
                    </BecCheckCard>

                    <BecCheckCard
                      title="Check 9: Intune Devices"
                      count={
                        becData?.IntuneDevicesError
                          ? undefined
                          : recentIntuneDeviceCount
                      }
                      completeness={completeness.IntuneDevices}
                    >
                      <Typography
                        variant="body2"
                        gutterBottom
                        color={
                          becData?.IntuneDevicesError ? 'error' : 'inherit'
                        }
                      >
                        {getIntuneDevicesMessage()}
                      </Typography>
                      {intuneDevices.length > 0 && (
                        <Box mt={2}>
                          <CippDataTable
                            noCard={true}
                            hideTitle={true}
                            title="Intune Devices"
                            data={intuneDevices}
                            simpleColumns={[
                              'deviceName',
                              'operatingSystem',
                              'osVersion',
                              'complianceState',
                              'enrolledDateTime',
                              'lastSyncDateTime',
                              'deviceEnrollmentType',
                              'serialNumber',
                            ]}
                            actions={intuneDeviceActions}
                          />
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 10: Sign-in Locations */}
                    <BecCheckCard
                      title="Check 10: Sign-in Locations"
                      count={
                        becData?.SuspectUserSignInsError
                          ? undefined
                          : foreignActivityCount
                      }
                      completeness={completeness.SignIns}
                    >
                      <Typography
                        variant="body2"
                        gutterBottom
                        color={
                          becData?.SuspectUserSignInsError ? 'error' : 'inherit'
                        }
                      >
                        {getSignInLocationMessage()}
                      </Typography>
                      {becData?.SuspectUserSignIns?.length > 0 && (
                        <Box mt={2}>
                          <CippDataTable
                            noCard={true}
                            hideTitle={true}
                            title="Sign-in Locations"
                            data={becData.SuspectUserSignIns}
                            simpleColumns={[
                              'CreatedDateTime',
                              'AppDisplayName',
                              'Status',
                              'IPAddress',
                              'Country',
                              'City',
                              'ForeignLocation',
                            ]}
                          />
                        </Box>
                      )}
                    </BecCheckCard>

                    {/* Check 11: Sharing Links */}
                    <BecCheckCard
                      title="Check 11: Sharing Links"
                      count={becData?.SharingChanges?.length || 0}
                      completeness={completeness.SharingChanges}
                    >
                      <Typography variant="body2" gutterBottom>
                        {getSharingMessage()}
                      </Typography>
                      {becData?.SharingChanges?.length > 0 && (
                        <Box mt={2}>
                          <CippDataTable
                            noCard={true}
                            hideTitle={true}
                            title="Sharing Links"
                            data={becData.SharingChanges}
                            simpleColumns={[
                              'Date',
                              'Operation',
                              'FileName',
                              'Target',
                              'Workload',
                              'ClientIP',
                              'Country',
                              'ForeignLocation',
                            ]}
                          />
                        </Box>
                      )}
                    </BecCheckCard>

                    {becData?.Scope === 'Full' && (
                      <>
                        {/* Check 12: Mailbox state & delegations */}
                        <BecCheckCard
                          title="Check 12: Mailbox state & delegations"
                          count={flaggedDelegations}
                          completeness={[
                            completeness.MailboxState,
                            completeness.Delegations,
                          ]}
                        >
                          <Typography variant="body2" gutterBottom>
                            {delegationRows.length === 0
                              ? 'No delegations (FullAccess, SendAs, SendOnBehalf, folder or resource) exist on this mailbox.'
                              : `${delegationRows.length} delegation(s) on this mailbox, ${flaggedDelegations} to an external, guest or catch-all principal. Assistants are normal; an unexplained trustee is how an attacker keeps reading after the password changes.`}
                            {mailboxState?.HasForwarding
                              ? ` Mail is being forwarded to ${
                                  mailboxState.ForwardingSmtpAddress ||
                                  mailboxState.ForwardingAddress
                                }${mailboxState.DeliverToMailboxAndForward ? ' (a copy stays in the mailbox)' : ''}.`
                              : ''}
                            {mailboxState?.AutoReplyState &&
                            mailboxState.AutoReplyState !== 'Disabled'
                              ? ` An automatic reply is ${mailboxState.AutoReplyState.toLowerCase()} (audience ${mailboxState.AutoReplyExternalAudience}).`
                              : ''}
                          </Typography>
                          {mailboxState && (
                            <Box mt={2}>
                              <PropertyList>
                                <PropertyListItem
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label="Forwarding"
                                  value={
                                    mailboxState.HasForwarding
                                      ? `${mailboxState.ForwardingSmtpAddress || mailboxState.ForwardingAddress}`
                                      : 'None'
                                  }
                                />
                                <PropertyListItem
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label="Automatic reply"
                                  value={`${mailboxState.AutoReplyState || 'Unknown'}${mailboxState.AutoReplyExternalAudience ? ` / ${mailboxState.AutoReplyExternalAudience}` : ''}`}
                                />
                                <PropertyListItem
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label="Protocols enabled"
                                  value={
                                    [
                                      'OWA',
                                      'EWS',
                                      'IMAP',
                                      'POP',
                                      'MAPI',
                                      'ActiveSync',
                                    ]
                                      .filter(
                                        (p) =>
                                          mailboxState[`${p}Enabled`] === true
                                      )
                                      .join(', ') || 'None'
                                  }
                                />
                                <PropertyListItem
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label="SMTP AUTH disabled"
                                  value={String(
                                    mailboxState.SmtpClientAuthenticationDisabled ??
                                      'Unknown'
                                  )}
                                />
                                <PropertyListItem
                                  sx={checkItemSx}
                                  align="horizontal"
                                  label="Mailbox auditing"
                                  value={String(
                                    mailboxState.AuditEnabled ?? 'Unknown'
                                  )}
                                />
                              </PropertyList>
                            </Box>
                          )}
                          {delegationRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Delegations"
                                data={delegationRows}
                                simpleColumns={[
                                  'PermissionType',
                                  'Trustee',
                                  'AccessRights',
                                  'Resource',
                                  'Flagged',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 13: Application consents */}
                        <BecCheckCard
                          title="Check 13: Application consents"
                          count={flaggedGrants}
                          completeness={completeness.UserGrants}
                        >
                          <Typography variant="body2" gutterBottom>
                            {grantRows.length === 0
                              ? 'This user has consented to no applications and holds no enterprise-app role assignments.'
                              : `${grantRows.length} consent grant(s) and role assignment(s), ${flaggedGrants} flagged: a rogue-catalog match (CIPP${becData?.HuntressFeedAvailable ? ' + Huntress' : ''}) or a high-risk scope from an unverified publisher. Consent survives a password reset; revoke what the user cannot explain.`}
                            {becData?.HuntressFeedAvailable === false
                              ? ' The Huntress rogue-apps feed was unavailable for this run; only the CIPP catalog was matched.'
                              : ''}
                          </Typography>
                          {grantRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Application consents"
                                data={grantRows}
                                simpleColumns={[
                                  'ClientDisplayName',
                                  'Type',
                                  'Risk',
                                  'HighRiskScopes',
                                  'Publisher',
                                  'PublisherVerified',
                                  'CatalogMatch',
                                  'Scope',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 14: Transport rules */}
                        <BecCheckCard
                          title="Check 14: Transport rules"
                          count={
                            flaggedTransportChanges +
                            transportFlaggedRows.length
                          }
                          completeness={[
                            completeness.TransportRuleChanges,
                            completeness.TransportRulesFlagged,
                          ]}
                        >
                          <Typography variant="body2" gutterBottom>
                            {transportChangeRows.length === 0
                              ? `No transport rules were created, changed, enabled, disabled or removed in the tenant in the last ${windowDays} days.`
                              : `${transportChangeRows.length} transport rule change(s) in the tenant in the last ${windowDays} days, ${flaggedTransportChanges} with a diversion or suppression action (BCC, redirect, delete, quarantine, spam score).`}{' '}
                            {transportFlaggedRows.length > 0
                              ? `${transportFlaggedRows.length} of the tenant's ${becData?.TransportRuleTotal ?? '?'} current rules carry such an action - review them even if they predate the window.`
                              : `None of the tenant's ${becData?.TransportRuleTotal ?? '?'} current rules carry such an action.`}
                          </Typography>
                          {transportChangeRows.length > 0 && (
                            <Box mt={2}>
                              <Typography variant="subtitle2" gutterBottom>
                                Changes in the window
                              </Typography>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Transport rule changes"
                                data={transportChangeRows}
                                simpleColumns={[
                                  'Date',
                                  'Operation',
                                  'RuleName',
                                  'Actor',
                                  'ClientIP',
                                  'Country',
                                  'RiskyParameters',
                                  'Flagged',
                                ]}
                              />
                            </Box>
                          )}
                          {transportFlaggedRows.length > 0 && (
                            <Box mt={2}>
                              <Typography variant="subtitle2" gutterBottom>
                                Current rules with diversion or suppression
                                actions
                              </Typography>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Flagged transport rules"
                                data={transportFlaggedRows}
                                simpleColumns={[
                                  'Name',
                                  'State',
                                  'Mode',
                                  'WhenChanged',
                                  'ChangedInWindow',
                                  'RiskReasons',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 15: Mailbox add-ins */}
                        <BecCheckCard
                          title="Check 15: Mailbox add-ins"
                          count={flaggedAddIns}
                          completeness={completeness.MailboxAddIns}
                        >
                          <Typography variant="body2" gutterBottom>
                            {addInRows.length === 0
                              ? 'No add-ins are installed for this mailbox.'
                              : `${addInRows.length} add-in(s) available to this mailbox, ${flaggedAddIns} user-installed from a non-Microsoft provider. Add-ins can read and send mail on the user's behalf; disable any the user does not recognise.`}
                          </Typography>
                          {addInRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Mailbox add-ins"
                                data={addInRows}
                                simpleColumns={[
                                  'DisplayName',
                                  'ProviderName',
                                  'Enabled',
                                  'Scope',
                                  'Type',
                                  'AppVersion',
                                  'Flagged',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 16: Received mail */}
                        <BecCheckCard
                          title="Check 16: Received mail"
                          count={receivedRows.length + deliveredThreats}
                          completeness={[
                            completeness.ReceivedMailFindings,
                            completeness.DefenderDetections,
                          ]}
                        >
                          <Typography variant="body2" gutterBottom>
                            {becData?.ReceivedMailSummary
                              ? `${becData.ReceivedMailSummary.TotalMessages} message(s) from ${becData.ReceivedMailSummary.UniqueSenders} sender(s) reached this mailbox in the last ${windowDays} days (trace metadata only). `
                              : ''}
                            {receivedRows.length === 0
                              ? 'No phishing-shaped subjects or look-alike sender domains were found.'
                              : `${receivedRows.length} finding(s): ${typosquatCount} from a look-alike of one of the tenant's own domains, the rest with phishing-shaped subjects.`}{' '}
                            {becData?.DefenderAvailable
                              ? defenderRows.length === 0
                                ? 'Defender for Office 365 classified none of the analysed mail as a threat.'
                                : `Defender for Office 365 classified ${defenderRows.length} message(s) as a threat, ${deliveredThreats} of which reached the mailbox.`
                              : completeness.DefenderDetections?.Error
                                ? `Defender analysed-email metadata was not available (${completeness.DefenderDetections.Error}).`
                                : ''}
                          </Typography>
                          <Box mt={1}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                setSpreadSender('')
                                setSpreadOpen(true)
                              }}
                            >
                              Trace a sender&apos;s spread
                            </Button>
                            <CippBecPhishingSpreadDialog
                              open={spreadOpen}
                              onClose={() => setSpreadOpen(false)}
                              tenantFilter={userSettingsDefaults.currentTenant}
                              defaultSender={spreadSender}
                              key={spreadSender}
                            />
                          </Box>
                          {receivedRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Received mail findings"
                                data={receivedRows}
                                simpleColumns={[
                                  'Received',
                                  'FindingType',
                                  'Severity',
                                  'SenderAddress',
                                  'Subject',
                                  'Reason',
                                  'Status',
                                ]}
                                actions={receivedMailActions}
                              />
                            </Box>
                          )}
                          {defenderRows.length > 0 && (
                            <Box mt={2}>
                              <Typography variant="subtitle2" gutterBottom>
                                Defender for Office 365 detections
                              </Typography>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Defender detections"
                                data={defenderRows}
                                simpleColumns={[
                                  'ReceivedDateTime',
                                  'SenderAddress',
                                  'Subject',
                                  'ThreatTypes',
                                  'DeliveryAction',
                                  'LatestDeliveryLocation',
                                  'Delivered',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 17: Directory audit */}
                        <BecCheckCard
                          title="Check 17: Entra directory audit"
                          count={flaggedAudits}
                          completeness={completeness.DirectoryAudits}
                        >
                          <Typography variant="body2" gutterBottom>
                            {directoryAuditRows.length === 0
                              ? `No directory audit events targeted or were initiated by this user in the last ${windowDays} days.`
                              : `${directoryAuditRows.length} directory audit event(s) in the last ${windowDays} days, ${flaggedAudits} flagged: security-info registration, consent, service principal, device registration, password, token or role events. These show who changed what, from where.`}
                          </Typography>
                          {directoryAuditRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Directory audit"
                                data={directoryAuditRows}
                                simpleColumns={[
                                  'ActivityDateTime',
                                  'Activity',
                                  'Result',
                                  'InitiatedBy',
                                  'ClientIP',
                                  'Country',
                                  'Targets',
                                  'Direction',
                                  'Flagged',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 18: Registered devices */}
                        <BecCheckCard
                          title="Check 18: Registered devices"
                          count={recentRegisteredDevices}
                          completeness={completeness.RegisteredDevices}
                        >
                          <Typography variant="body2" gutterBottom>
                            {registeredDeviceRows.length === 0
                              ? 'No Entra devices are registered to this user.'
                              : `${registeredDeviceRows.length} Entra device(s) registered to this user, ${recentRegisteredDevices} in the last ${windowDays} days. A device registered during the window can be an attacker's VM or phone, and a route to Windows Hello for Business persistence.`}
                          </Typography>
                          {registeredDeviceRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Registered devices"
                                data={registeredDeviceRows}
                                simpleColumns={[
                                  'displayName',
                                  'operatingSystem',
                                  'trustType',
                                  'registrationDateTime',
                                  'approximateLastSignInDateTime',
                                  'accountEnabled',
                                  'isCompliant',
                                  'RegisteredInWindow',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 19: Non-interactive sign-ins */}
                        <BecCheckCard
                          title="Check 19: Non-interactive sign-ins"
                          count={foreignNonInteractive}
                          completeness={completeness.NonInteractiveSignIns}
                        >
                          <Typography variant="body2" gutterBottom>
                            {nonInteractiveRows.length === 0
                              ? 'No non-interactive sign-ins were found for this user.'
                              : `${nonInteractiveRows.length} most recent non-interactive sign-in(s) (token refreshes and background token use), ${foreignNonInteractive} successful from outside the usage location. Stolen tokens and adversary-in-the-middle sessions show up here rather than in the interactive log.`}
                          </Typography>
                          {nonInteractiveRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Non-interactive sign-ins"
                                data={nonInteractiveRows}
                                simpleColumns={[
                                  'CreatedDateTime',
                                  'AppDisplayName',
                                  'ResourceDisplayName',
                                  'Status',
                                  'IPAddress',
                                  'Country',
                                  'City',
                                  'IncomingTokenType',
                                  'ForeignLocation',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 20: Mailbox activity */}
                        <BecCheckCard
                          title="Check 20: Mailbox activity"
                          count={
                            becData?.MailActivitySummary?.HardDeleteExceeded
                              ? 1
                              : 0
                          }
                          completeness={completeness.MailActivity}
                        >
                          <Typography variant="body2" gutterBottom>
                            {becData?.MailActivitySummary
                              ? `${becData.MailActivitySummary.MailItemsAccessedCount} item access(es), ${becData.MailActivitySummary.HardDeleteCount} hard delete(s), ${becData.MailActivitySummary.SoftDeleteCount} soft delete(s) and ${becData.MailActivitySummary.SendCount} send(s) recorded in the last ${windowDays} days from ${becData.MailActivitySummary.DistinctClientIPs} client IP(s)${
                                  becData.MailActivitySummary
                                    .SendAsByOthersCount > 0
                                    ? `, plus ${becData.MailActivitySummary.SendAsByOthersCount} message(s) sent as or on behalf of this user by someone else`
                                    : ''
                                }. Counts only - no items were read.${
                                  becData.MailActivitySummary.HardDeleteExceeded
                                    ? ` Hard deletes exceed the ${becData.MailActivitySummary.HardDeleteThreshold} threshold, which is how attackers hide their tracks.`
                                    : ''
                                }`
                              : 'No mailbox activity counts were collected.'}
                          </Typography>
                          {mailActivityRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Mailbox activity"
                                data={mailActivityRows}
                                simpleColumns={[
                                  'Operation',
                                  'Count',
                                  'ClientIP',
                                  'Country',
                                  'ForeignLocation',
                                  'ClientInfoString',
                                  'MailAccessType',
                                  'Actor',
                                  'FirstSeen',
                                  'LastSeen',
                                ]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>

                        {/* Check 21: Identity Protection */}
                        <BecCheckCard
                          title="Check 21: Identity Protection"
                          count={riskDetectionRows.length}
                          completeness={completeness.RiskState}
                        >
                          <Typography variant="body2" gutterBottom>
                            {riskState?.Listed
                              ? `Identity Protection lists this user as ${riskState.RiskState} at ${riskState.RiskLevel} risk (${riskState.RiskDetail || 'no detail'}, last updated ${riskState.RiskLastUpdatedDateTime}).`
                              : completeness.RiskState?.Error
                                ? 'Identity Protection state could not be read (Entra ID P2 and the IdentityRiskyUser permission are required).'
                                : 'Identity Protection does not list this user as risky.'}
                            {riskDetectionRows.length > 0
                              ? ` ${riskDetectionRows.length} risk detection(s) in the last ${windowDays} days.`
                              : ''}
                          </Typography>
                          {riskDetectionRows.length > 0 && (
                            <Box mt={2}>
                              <CippDataTable
                                noCard={true}
                                hideTitle={true}
                                title="Risk detections"
                                data={riskDetectionRows}
                                simpleColumns={[
                                  'DetectedDateTime',
                                  'RiskEventType',
                                  'RiskLevel',
                                  'RiskState',
                                  'IPAddress',
                                  'Country',
                                  'City',
                                  'Activity',
                                ]}
                              />
                            </Box>
                          )}
                          {riskState?.Listed && (
                            <Box mt={2}>
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => dismissRiskDialog.handleOpen()}
                              >
                                Dismiss risk in Identity Protection
                              </Button>
                              <CippApiDialog
                                title="Dismiss user risk"
                                createDialog={dismissRiskDialog}
                                api={{
                                  url: '/api/ExecDismissRiskyUser',
                                  type: 'POST',
                                  data: {
                                    tenantFilter: `!${userSettingsDefaults.currentTenant}`,
                                    userId: 'id',
                                    userDisplayName: 'displayName',
                                  },
                                  confirmText:
                                    'Dismiss the Identity Protection risk for [userPrincipalName]? Do this only once the account is contained and the activity explained.',
                                }}
                                row={userRequest.data[0]}
                              />
                            </Box>
                          )}
                        </BecCheckCard>
                      </>
                    )}

                    <CippBecContentSearchCard
                      tenantFilter={userSettingsDefaults.currentTenant}
                      caseId={becData?.CaseId}
                      becData={becData}
                      isSuperAdmin={actionsCatalog.data?.IsSuperAdmin === true}
                      defaultSender={receivedRows[0]?.SenderAddress || ''}
                    />

                    {/* Report Data */}
                    <BecCheckCard title="Report">
                      <Typography variant="body2" gutterBottom>
                        Generate a comprehensive PDF report for documentation,
                        compliance, or end-user review. The report includes
                        detailed explanations suitable for non-technical users,
                        managers, and compliance requirements (ISO/CMMC/SOC).
                      </Typography>
                      {/* Implement download functionality */}
                      {becData && (
                        <Box sx={{ mt: 2 }}>
                          <Stack direction="row" spacing={2}>
                            <BECRemediationReportButton
                              userData={userRequest.data[0]}
                              becData={becData}
                              tenantName={userSettingsDefaults.currentTenant}
                            />
                            <Button
                              onClick={() => {
                                const blob = new Blob(
                                  [JSON.stringify(becData, null, 2)],
                                  {
                                    type: 'application/json',
                                  }
                                )
                                const url = URL.createObjectURL(blob)
                                const link = document.createElement('a')
                                link.href = url
                                link.download = `BEC_Report_${userRequest.data[0].userPrincipalName}${
                                  becData?.CaseId ? `_${becData.CaseId}` : ''
                                }.json`
                                link.click()
                                URL.revokeObjectURL(url)
                              }}
                              variant="outlined"
                              startIcon={
                                <SvgIcon fontSize="small">
                                  <CippIcons.Download />
                                </SvgIcon>
                              }
                            >
                              Download JSON
                            </Button>
                          </Stack>
                          {activeCaseId && (
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                The evidence package bundles the PDF report, the
                                results JSON, a CSV per finding set, the
                                containment history and every logbook entry for
                                this case into a ZIP with a SHA-256 manifest, so
                                the findings can be handed over and verified
                                later. Metadata only.
                              </Typography>
                              <CippBecEvidenceExportButton
                                tenantFilter={
                                  userSettingsDefaults.currentTenant
                                }
                                caseId={activeCaseId}
                                userData={userRequest.data[0]}
                                becData={becData}
                                tenantName={userSettingsDefaults.currentTenant}
                              />
                            </Box>
                          )}
                        </Box>
                      )}
                    </BecCheckCard>
                  </>
                )}
              </Stack>
            </Grid>
          </Grid>
        </Box>
      )}
    </HeaderedTabbedLayout>
  )
}

Page.getLayout = (page) => <DashboardLayout>{page}</DashboardLayout>

export default Page
