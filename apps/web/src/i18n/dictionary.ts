export type Locale = 'en' | 'ur';

export type MessageKey =
  | 'osTitle'
  | 'osSearch'
  | 'osFilterAll'
  | 'osFilterTodo'
  | 'osFilterDone'
  | 'osColProduct'
  | 'osColUnit'
  | 'osColQty'
  | 'osColCost'
  | 'osColValue'
  | 'osColPrice'
  | 'osPcs'
  | 'osEntered'
  | 'osTotalQty'
  | 'osTotalValue'
  | 'osSaving'
  | 'osSaved'
  | 'osSaveFailed'
  | 'osDownloadExcel'
  | 'osFillExcel'
  | 'osPost'
  | 'osExcelOnly'
  | 'osPreviewTitle'
  | 'osPreviewMsg'
  | 'osApply'
  | 'osCancel'
  | 'osMatched'
  | 'osUnmatched'
  | 'osErrors'
  | 'osRow'
  | 'osBarcode'
  | 'osChangeNew'
  | 'osChangeUpdate'
  | 'osChangeSame'
  | 'osConfirmTitle'
  | 'osConfirmMsg'
  | 'osConfirmAdded'
  | 'osNoCost'
  | 'osConfirmBtn'
  | 'osPosting'
  | 'osNow'
  | 'osAdd'
  | 'osAfter'
  | 'osBatchTitle'
  | 'osItems'
  | 'osExcel'
  | 'osPdf'
  | 'osUndo'
  | 'osUndone'
  | 'osAddMore'
  | 'osContinue'
  | 'osColEnteredAs'
  | 'osColBefore'
  | 'osAdded'
  | 'osUndoTitle'
  | 'osUndoMsg'
  | 'osBlockSold'
  | 'osBlockBought'
  | 'osBlockReturned'
  | 'osBlockRepacked'
  | 'osBlockChanged'
  | 'osBlockNotLast'
  | 'osErrSameName'
  | 'osErrDup'
  | 'osErrBoth'
  | 'osErrQty'
  | 'osErrCost'
  | 'osErrUnits'
  | 'osErrFile'
  | 'osErrNoCols'
  | 'osErrNothing'
  | 'osFilled'
  | 'osPostedFlash'
  | 'osUndoneFlash'
  | 'osNotFound'
  | 'osNoRows'
  | 'osTotal'
  | 'osPosted'
  | 'osCostWarn'
  | 'osAddsTo'
  | 'osBy'
  | 'errPackUnitsRequired'
  | 'errBulkBuysByKg'
  | 'errInvalidBuyUnit'
  | 'buPiece'
  | 'buCrate'
  | 'buCarton'
  | 'buBoughtBy'
  | 'buBoughtLoose'
  | 'rsTitle'
  | 'rsKeeps'
  | 'rsButton'
  | 'rsModalTitle'
  | 'rsModalMsg'
  | 'rsTypeLabel'
  | 'rsConfirm'
  | 'rsBusy'
  | 'rsDone'
  | 'rsFailed'
  | 'bcMore'
  | 'bcMoreHint'
  | 'bcAdd'
  | 'bcRemove'
  | 'bcAlready'
  | 'bcTaken'
  | 'buPackedFrom'
  | 'buInvalidMeasure'
  | 'rpLabelsBtn'
  | 'rpLabelsSkip'
  | 'rpLabelsTitle'
  | 'ptRepackBtn'
  | 'ptBulkNotLoose'
  | 'ptPackedBuyBulk'
  | 'errRunAlreadyUndone'
  | 'errPackedNotPurchasable'
  | 'errInvalidProductType'
  | 'errPackedIsPieces'
  | 'errPackedNeedsKg'
  | 'errPackedNeedsBulk'
  | 'errBulkHasPackets'
  | 'errBulkNeedsKg'
  | 'ptSellLoose'
  | 'ptKgPerPack'
  | 'ptPacked'
  | 'ptBulk'
  | 'ptNormal'
  | 'ptType'
  | 'offersTitle'
  | 'offersFilterAll'
  | 'offersFilterKhata'
  | 'offersFilterRecent'
  | 'offersFilterTop'
  | 'offersSelectAll'
  | 'offersKhata'
  | 'offersLast30'
  | 'offersBadPhone'
  | 'offersNoPhone'
  | 'waAddPhone'
  | 'waFixPhone'
  | 'offersSelected'
  | 'offersWrite'
  | 'offersTemplates'
  | 'offersMessage'
  | 'offersTemplateName'
  | 'offersSaveTemplate'
  | 'offersStart'
  | 'offersInvalid'
  | 'offersProgress'
  | 'offersSent'
  | 'offersSkipped'
  | 'offersStop'
  | 'offersSkip'
  | 'offersOpen'
  | 'offersNext'
  | 'offersDone'
  | 'activityKindOffers'
  | 'themeDark'
  | 'themeLight'
  | 'rulesLoyalty'
  | 'rulesLoyaltyRsPer'
  | 'rulesLoyaltyPointRs'
  | 'loyaltyPoints'
  | 'loyaltyUseAll'
  | 'scaleRead'
  | 'scaleReading'
  | 'scaleTitle'
  | 'scaleEnable'
  | 'scalePort'
  | 'scaleBaud'
  | 'scalePoll'
  | 'scaleTest'
  | 'customerDisplay'
  | 'waReminder'
  | 'errScaleNoReading'
  | 'errScaleNoPort'
  | 'errScaleUnsupported'
  | 'errLoyaltyNotEnough'
  | 'errLoyaltyNeedsCustomer'
  | 'errLoyaltyOff'
  | 'errLoyaltyOverBill'
  | 'tillDigitalShort'
  | 'notifExpiryTitle'
  | 'notifActionExpiry'
  | 'returnUndone'
  | 'returnUndo'
  | 'returnReason'
  | 'returnUndoMsg'
  | 'tillDigital'
  | 'productProfitTitle'
  | 'dateFrom'
  | 'dateTo'
  | 'ppProfit'
  | 'ppSales'
  | 'ppMargin'
  | 'ppCost'
  | 'ppEmpty'
  | 'ppCostUnknown'
  | 'supplierSendBack'
  | 'supplierReturns'
  | 'importTitle'
  | 'importColumns'
  | 'importToAdd'
  | 'importSkipped'
  | 'importErrors'
  | 'importExists'
  | 'importAdded'
  | 'importGo'
  | 'errImportColumns'
  | 'errImportBadFile'
  | 'priceHistory'
  | 'priceHistoryEmpty'
  | 'priceOld'
  | 'priceNew'
  | 'creditLimit'
  | 'creditLimitNone'
  | 'rulesTitle'
  | 'rulesRounding'
  | 'rulesRoundOff'
  | 'rulesCashierDiscount'
  | 'rulesCreditMode'
  | 'rulesCreditWarn'
  | 'rulesCreditBlock'
  | 'rulesExpiryDays'
  | 'rulesDrawerKick'
  | 'close'
  | 'activityTitle'
  | 'activityAll'
  | 'activitySales'
  | 'activityVoids'
  | 'activityReturns'
  | 'activityPrices'
  | 'activityWriteOffs'
  | 'activityPurchases'
  | 'activityKindSale'
  | 'activityKindVoid'
  | 'activityKindEdit'
  | 'activityKindReturn'
  | 'activityKindReturnUndo'
  | 'activityKindPrice'
  | 'activityKindWriteOff'
  | 'activityKindPurchase'
  | 'activityKindExpense'
  | 'activityWho'
  | 'activityEveryone'
  | 'activityDay'
  | 'activityEmpty'
  | 'activityWhat'
  | 'activitySubject'
  | 'amount'
  | 'shortcutsTitle'
  | 'shortcutsSell'
  | 'shortcutsPay'
  | 'shortcutsGeneral'
  | 'stockCare'
  | 'writeOffNew'
  | 'reorderTitle'
  | 'expiryTitle'
  | 'writeOffsTitle'
  | 'reorderEmpty'
  | 'reorderMakePurchase'
  | 'colItem'
  | 'reorderLevel'
  | 'reorderSuggest'
  | 'expiryEmpty'
  | 'expiryDate'
  | 'batchNo'
  | 'expiryLeft'
  | 'expiredChip'
  | 'expiryDaysLeft'
  | 'writeOffAction'
  | 'expiryDismiss'
  | 'writeOffsEmpty'
  | 'writeOffsValue'
  | 'writeOffExpired'
  | 'writeOffDamaged'
  | 'writeOffPick'
  | 'note'
  | 'expiryDismissMsg'
  | 'errQtyExceedsStock'
  | 'creditOverLimit'
  | 'payType'
  | 'payTypeCash'
  | 'payRef'
  | 'payReceived'
  | 'billDiscount'
  | 'billRounding'
  | 'billSubtotal'
  | 'discountOverLimit'
  | 'packUnit'
  | 'packPiece'
  | 'packDozen'
  | 'packCarton'
  | 'creditAllowOnce'
  | 'errDiscountOverLimit'
  | 'errCreditLimitExceeded'
  | 'errInvalidDigital'
  | 'errInvalidDiscount'
  | 'errUndoSameDay'
  | 'errUndoStockSold'
  | 'errInvalidExpiry'
  | 'errNoRows'
  | 'qtyWeight'
  | 'qtyRsWorth'
  | 'errRefundExceedsCash'
  | 'errUdhaarNeedsCustomer'
  | 'saved'
  | 'tillTitle'
  | 'tillOpenSince'
  | 'tillCashIn'
  | 'tillCashOut'
  | 'tillClose'
  | 'tillOpen'
  | 'tillFloat'
  | 'tillCashSales'
  | 'tillUdhaarReceived'
  | 'tillRefunds'
  | 'tillExpenses'
  | 'tillExpected'
  | 'tillCounted'
  | 'tillOverShort'
  | 'tillSales'
  | 'tillUdhaarGiven'
  | 'tillReturns'
  | 'tillMoves'
  | 'tillTime'
  | 'tillReason'
  | 'tillUndo'
  | 'tillHistory'
  | 'tillNoShifts'
  | 'tillOpened'
  | 'tillClosed'
  | 'tillOpenNow'
  | 'tillPrintZ'
  | 'tillZTitle'
  | 'tillExact'
  | 'tillShort'
  | 'tillOver'
  | 'tillNote'
  | 'errTillAlreadyOpen'
  | 'errTillNotOpen'
  | 'errCashOutExceedsTill'
  | 'errInvalidAmount'
  | 'errFolderNotAbsolute'
  | 'errFolderNotWritable'
  | 'errFolderRequired'
  | 'errKeepCount'
  | 'errBackupBusy'
  | 'errAutoBackupFailed'
  | 'bkAutoTitle'
  | 'bkAutoLastFailed'
  | 'bkAutoLast'
  | 'bkAutoNever'
  | 'bkAutoEnable'
  | 'bkAutoFolder'
  | 'bkAutoChoose'
  | 'bkAutoKeep'
  | 'bkAutoRunNow'
  | 'bkAutoFile'
  | 'bkAutoSize'
  | 'appName'
  | 'login'
  | 'pinLogin'
  | 'pin'
  | 'confirmPin'
  | 'staffPinShort'
  | 'forgotPin'
  | 'recoveryCode'
  | 'recoveryTitle'
  | 'recoverySaved'
  | 'recoveryCopy'
  | 'recoveryCopied'
  | 'recoveryPrint'
  | 'recoveryDone'
  | 'recoverSetPin'
  | 'recoverBack'
  | 'recoveryNew'
  | 'changeMyPin'
  | 'badRecoveryCode'
  | 'tooManyAttempts'
  | 'signIn'
  | 'signOut'
  | 'owner'
  | 'cashier'
  | 'cashierToday'
  | 'cashierTodayNote'
  | 'cashierGoSell'
  | 'cashierTodaySales'
  | 'cashierTodayEmpty'
  | 'ownerHome'
  | 'posShell'
  | 'catalog'
  | 'taxQueue'
  | 'language'
  | 'langEn'
  | 'langUr'
  | 'paymentsNote'
  | 'emptyCatalog'
  | 'healthOk'
  | 'healthFail'
  | 'back'
  | 'selectUser'
  | 'firstRunTitle'
  | 'firstRunNote'
  | 'displayName'
  | 'storeName'
  | 'storeNamePlaceholder'
  | 'createOwner'
  | 'addProduct'
  | 'productName'
  | 'barcode'
  | 'barcodeOptional'
  | 'barcodeHint'
  | 'scanBarcode'
  | 'scanBarcodeEnter'
  | 'barcodeNotFound'
  | 'duplicateBarcode'
  | 'invalidBarcode'
  | 'priceRs'
  | 'unit'
  | 'unitPiece'
  | 'unitPacket'
  | 'unitKg'
  | 'unitGram'
  | 'unitLitre'
  | 'unitMl'
  | 'unitDozen'
  | 'unitPair'
  | 'unitBox'
  | 'unitBottle'
  | 'unitCan'
  | 'unitJar'
  | 'unitTin'
  | 'unitTube'
  | 'unitBar'
  | 'unitSachet'
  | 'unitStrip'
  | 'unitTray'
  | 'unitRoll'
  | 'unitBundle'
  | 'unitBag'
  | 'unitMeter'
  | 'unitFoot'
  | 'unitCarton'
  | 'productList'
  | 'loading'
  | 'onHand'
  | 'qty'
  | 'piecesPerCarton'
  | 'cashierStubNote'
  | 'sell'
  | 'addToCart'
  | 'cart'
  | 'cartEmpty'
  | 'cartTotal'
  | 'payCash'
  | 'payUdhaar'
  | 'paySheet'
  | 'saleDone'
  | 'saleId'
  | 'newSale'
  | 'insufficientStock'
  | 'cuStatCustomers'
  | 'cuStatOwed'
  | 'cuStatOwing'
  | 'cuStatOverLimit'
  | 'cuFilterClear'
  | 'cuFilterOver'
  | 'cuSort'
  | 'cuSortName'
  | 'cuSortBalance'
  | 'cuSortNewest'
  | 'cuColLimit'
  | 'cuColSince'
  | 'cuColEntry'
  | 'cuColDebit'
  | 'cuEntrySale'
  | 'cuEntryDebit'
  | 'cuEntryPayment'
  | 'cuReceivePayment'
  | 'cuLimitUsed'
  | 'cuAdvance'
  | 'cuEdit'
  | 'sellShortage'
  | 'sellShortageLeft'
  | 'errorWithCode'
  | 'errDuplicateLine'
  | 'errForbidden'
  | 'errOwnerOnly'
  | 'errInvalidCreditLimit'
  | 'errInvalidLine'
  | 'errInvalidPaid'
  | 'errInvalidRange'
  | 'errRangeTooLong'
  | 'errInvalidRefund'
  | 'errRefundMismatch'
  | 'errInvalidStatus'
  | 'errKhataNeedsCustomer'
  | 'errMessageRequired'
  | 'errQtyExceedsSold'
  | 'errReasonRequired'
  | 'errReplaceFailed'
  | 'errSaleHasReturns'
  | 'errSaleNotToday'
  | 'errSaleVoided'
  | 'cashOnlyNote'
  | 'cashUdhaarNote'
  | 'noSplitNote'
  | 'splitPayNote'
  | 'cashTendered'
  | 'changeToReturn'
  | 'moreStillDue'
  | 'receiptPaid'
  | 'receiptChange'
  | 'remainder'
  | 'remainderNeedsParty'
  | 'remainderOptionalParty'
  | 'optionalCustomer'
  | 'walkInCustomer'
  | 'paySplit'
  | 'parties'
  | 'partiesNote'
  | 'partyList'
  | 'emptyParties'
  | 'addFirstParty'
  | 'addParty'
  | 'editCustomer'
  | 'saveCustomer'
  | 'editCustomerFailed'
  | 'partyName'
  | 'partyPhone'
  | 'partyAddress'
  | 'searchParties'
  | 'partiesNoMatches'
  | 'balance'
  | 'partiesUnavailable'
  | 'partyDetailUnavailable'
  | 'addPartyFailed'
  | 'collectFailed'
  | 'udhaarParty'
  | 'pickParty'
  | 'createParty'
  | 'taxQueueNote'
  | 'taxPending'
  | 'taxRejected'
  | 'taxDispositionNote'
  | 'taxVoidSale'
  | 'taxKeepFlag'
  | 'taxCreditNote'
  | 'taxProcessNext'
  | 'taxProcessed'
  | 'taxQueueEmpty'
  | 'backup'
  | 'backupBadPin'
  | 'backupDataRegion'
  | 'backupRestoreFailed'
  | 'bkNote'
  | 'bkChecking'
  | 'bkTryAgain'
  | 'bkLastSaved'
  | 'bkNeverSaved'
  | 'bkStale'
  | 'bkToday'
  | 'bkYesterday'
  | 'bkStepsLabel'
  | 'bkStep1'
  | 'bkStep2'
  | 'bkStep3'
  | 'bkSaveTitle'
  | 'bkSaveDesc'
  | 'bkPin'
  | 'bkSaveNow'
  | 'bkSaving'
  | 'bkSaved'
  | 'bkSavedTo'
  | 'bkSavedDownloads'
  | 'bkCopyPath'
  | 'bkPathCopied'
  | 'bkUsbTip'
  | 'bkRestoreTitle'
  | 'bkRestoreDesc'
  | 'bkRestoreEmpty'
  | 'bkChooseFile'
  | 'bkChangeFile'
  | 'bkCopyFrom'
  | 'bkCopyCounts'
  | 'bkRestoreBtn'
  | 'bkConfirmTitle'
  | 'bkConfirmMsg'
  | 'bkConfirmKeep'
  | 'bkOldCopyNote'
  | 'bkSaveFirst'
  | 'bkConfirmYes'
  | 'bkRestoring'
  | 'bkRestored'
  | 'bkRestoredSafety'
  | 'bkSaveFirstStopped'
  | 'bkNotACopy'
  | 'bkWrongVersion'
  | 'bkFileUnreadable'
  | 'bkMore'
  | 'bkPasteLabel'
  | 'bkUsePasted'
  | 'bkStoredLocal'
  | 'bkLastRestored'
  | 'bkCopyVersion'
  | 'analytics'
  | 'analyticsNote'
  | 'analyticsToday'
  | 'analyticsLast7Days'
  | 'analyticsSalesTotal'
  | 'analyticsCash'
  | 'analyticsUdhaar'
  | 'analyticsSaleCount'
  | 'analyticsTopProducts'
  | 'analyticsLowStock'
  | 'analyticsLowStockEmpty'
  | 'analyticsUdhaarOutstanding'
  | 'analyticsEmpty'
  | 'analyticsStockAlerts'
  | 'analyticsUnavailable'
  | 'retry'
  | 'staff'
  | 'staffNote'
  | 'staffAddCashier'
  | 'staffCreateCashier'
  | 'staffUsers'
  | 'staffEmpty'
  | 'staffDeactivate'
  | 'staffDisabled'
  | 'staffPinOnceTitle'
  | 'staffPinOnceNote'
  | 'staffPinOnceDismiss'
  | 'staffPinLabel'
  | 'roleDataEntry'
  | 'roleHelper'
  | 'salaryKindDue'
  | 'salaryKindPayment'
  | 'salaryKindAdvance'
  | 'salaryKindDeduction'
  | 'salaryKindBonus'
  | 'salaryRunDone'
  | 'payslipTitle'
  | 'salaryBalance'
  | 'salaryAdvanceLeft'
  | 'payslipSignature'
  | 'staffAdd'
  | 'staffEdit'
  | 'staffSave'
  | 'staffPosition'
  | 'posCashier'
  | 'posSalesman'
  | 'posHelper'
  | 'posStoreKeeper'
  | 'posDataEntry'
  | 'posDelivery'
  | 'posManager'
  | 'posOther'
  | 'posCustom'
  | 'staffMonthlySalary'
  | 'salaryVoidTitle'
  | 'staffEnableTitle'
  | 'staffEnableConfirm'
  | 'salaryVoid'
  | 'staffEnable'
  | 'staffResetPin'
  | 'staffNewPin'
  | 'salaryRun'
  | 'salaryMonth'
  | 'salaryRunNobody'
  | 'staffColSalary'
  | 'salaryAdvanceCut'
  | 'salaryPayable'
  | 'salaryRunAdded'
  | 'salaryRunConfirm'
  | 'salaryPay'
  | 'salaryGiveAdvance'
  | 'salaryAddBonus'
  | 'salaryPaidFrom'
  | 'salaryFromDrawer'
  | 'salaryOutsideDrawer'
  | 'staffBack'
  | 'payslipPrint'
  | 'salaryKhata'
  | 'salaryKhataEmpty'
  | 'salaryEntry'
  | 'salaryVoided'
  | 'salaryKhataShort'
  | 'errSalaryOverBalance'
  | 'errVoidSameDay'
  | 'errNoLogin'
  | 'errInvalidRole'
  | 'errCannotChangeOwner'
  | 'errSalaryManagedInStaff'
  | 'errInvalidPeriod'
  | 'searchStaff'
  | 'staffColName'
  | 'staffColRole'
  | 'staffColStatus'
  | 'staffActive'
  | 'staffNoMatches'
  | 'staffDeactivateTitle'
  | 'staffPinShow'
  | 'staffPinHide'
  | 'staffPinCopy'
  | 'staffPinCopied'
  | 'staffDeactivateConfirm'
  | 'staffDeactivateConfirmYes'
  | 'receipt'
  | 'viewReceipt'
  | 'receiptPrint'
  | 'receiptShare'
  | 'receiptTotal'
  | 'receiptPayment'
  | 'receiptCash'
  | 'receiptUdhaar'
  | 'receiptSplit'
  | 'receiptParty'
  | 'receiptSaleId'
  | 'receiptClientTime'
  | 'receiptRecordedTime'
  | 'receiptShared'
  | 'receiptCopied'
  | 'receiptShareFailed'
  | 'receiptPrinted'
  | 'receiptPrintFailed'
  | 'saleDoneFlash'
  | 'receiptPrintAfterSale'
  | 'receiptPrintAfterSaleHint'
  | 'recordCollection'
  | 'collectNote'
  | 'collectAmountRs'
  | 'collectNoteOptional'
  | 'collectRecorded'
  | 'collectOverBalance'
  | 'collectAmountInvalid'
  | 'ledger'
  | 'ledgerDebit'
  | 'ledgerCredit'
  | 'emptyLedger'
  | 'zeroBalance'
  | 'backToParties'
  | 'backToPurchases'
  | 'openParty'
  | 'searchProducts'
  | 'estStock'
  | 'softStock'
  | 'payFullCash'
  | 'payAllUdhaar'
  | 'taxQueued'
  | 'taxAccepted'
  | 'saleFailed'
  | 'partyRequired'
  | 'invalidQty'
  | 'invalidCashTendered'
  | 'catalogUnavailable'
  | 'emptyCatalogCashier'
  | 'confirmSale'
  | 'exactCash'
  | 'settings'
  | 'settingsNote'
  | 'settingsStoreProfile'
  | 'settingsPhone'
  | 'settingsAddress'
  | 'settingsReceiptFooter'
  | 'settingsLocaleDefault'
  | 'settingsSave'
  | 'settingsSaved'
  | 'settingsSaveFailed'
  | 'settingsChangePin'
  | 'settingsCurrentPin'
  | 'settingsNewPin'
  | 'settingsPinChanged'
  | 'settingsPinBadCurrent'
  | 'settingsPinInvalid'
  | 'settingsPinMismatch'
  | 'settingsPinFailed'
  | 'settingsTaxMode'
  | 'settingsTaxModeNote'
  | 'settingsTaxSimulate'
  | 'settingsAbout'
  | 'settingsSqlite'
  | 'settingsTabAccount'
  | 'searchCatalog'
  | 'addFirstProduct'
  | 'productNameEn'
  | 'productNameUr'
  | 'addAnotherSize'
  | 'sizeQty'
  | 'activityKindSizes'
  | 'activityPurchaseOrders'
  | 'repackTitle'
  | 'activityRepack'
  | 'sizePricesTitle'
  | 'sizePricesAll'
  | 'sizePricesOne'
  | 'sizeOldPrice'
  | 'sizeNewPrice'
  | 'invalidSizeQty'
  | 'cartonPriceRs'
  | 'piecePriceRs'
  | 'cottonHelp'
  | 'editProduct'
  | 'productPhoto'
  | 'addPhoto'
  | 'changePhoto'
  | 'removePhoto'
  | 'invalidImage'
  | 'saveProduct'
  | 'cancel'
  | 'catalogNoMatches'
  | 'goReceiveStock'
  | 'askOwnerReceive'
  | 'invalidName'
  | 'invalidPrice'
  | 'invalidPiecesPerCarton'
  | 'invalidUnit'
  | 'invalidUnitLabel'
  | 'addFailed'
  | 'receiveFailed'
  | 'cartonPriceSoon'
  | 'emptyStateCatalogTitle'
  | 'emptyStateCatalogDesc'
  | 'emptyStateCatalogCashierTitle'
  | 'emptyStateCatalogCashierDesc'
  | 'emptyStatePartiesTitle'
  | 'emptyStatePartiesDesc'
  | 'emptyStateCashierTodayTitle'
  | 'emptyStateCashierTodayDesc'
  | 'emptyStateTaxTitle'
  | 'emptyStateTaxDesc'
  | 'emptyStateTaxBack'
  | 'emptyStateAnalyticsTitle'
  | 'emptyStateAnalyticsDesc'
  | 'emptyStateStaffTitle'
  | 'emptyStateStaffDesc'
  | 'setupLanguage'
  | 'setupLanguageNote'
  | 'sampleTitle'
  | 'sampleNote'
  | 'sampleAdd'
  | 'sampleSkip'
  | 'sampleFailed'
  | 'errorGeneric'
  | 'usersUnavailable'
  | 'loginFailed'
  | 'invalidPin'
  | 'invalidDisplayName'
  | 'invalidStoreName'
  | 'invalidLocale'
  | 'alreadySetup'
  | 'notSetup'
  | 'userRequired'
  | 'pinMismatch'
  | 'setupFailed'
  | 'staffUnavailable'
  | 'staffNameRequired'
  | 'staffCreateFailed'
  | 'staffDeactivateFailed'
  | 'cannotDisableOwner'
  | 'errorNotFound'
  | 'backupUnavailable'
  | 'backupExportFailed'
  | 'settingsUnavailable'
  | 'todayUnavailable'
  | 'cashierTodayUnavailable'
  | 'taxUnavailable'
  | 'taxProcessFailed'
  | 'taxDisposeFailed'
  | 'taxNotRejected'
  | 'taxAlreadyDisposed'
  | 'saleAlreadyVoided'
  | 'emptyCart'
  | 'invalidProduct'
  | 'productNotFound'
  | 'partyNotAllowedCash'
  | 'partyNotFound'
  | 'invalidSplit'
  | 'partyNameRequired'
  | 'partyNameTooLong'
  | 'removeLine'
  | 'taxReason'
  | 'taxRef'
  | 'taxStatusQueued'
  | 'taxStatusSubmitting'
  | 'taxStatusVoided'
  | 'taxStatusCreditNote'
  | 'taxStatusFlagged'
  | 'taxStatusPending'
  | 'taxVoidedDone'
  | 'taxKeptFlagged'
  | 'taxCreditQueued'

  | 'lastUnitCost'
  | 'costUnknown'
  | 'profitToday'
  | 'cogsToday'
  | 'grossProfit'
  | 'markup'
  | 'expensesTitle'
  | 'expenseBill'
  | 'expenseSalary'
  | 'expenseCommission'
  | 'expenseAmountRs'
  | 'expenseDate'
  | 'expenseNote'
  | 'expenseNoteOptional'
  | 'expenseCategory'
  | 'expenseColAmount'
  | 'expenseAdd'
  | 'expenseDelete'
  | 'expenseToday'
  | 'leftAfterExpenses'
  | 'profitUnknown'
  | 'expenseFailed'
  | 'invalidAmount'
  | 'amountRequired'
  | 'invalidExpenseKind'
  | 'invalidDate'
  | 'soldFor'
  | 'paidCost'
  | 'lineProfit'
  | 'sellPiecesOnly'
  | 'productAdded'
  | 'expenseEmpty'
  | 'expenseEmptyDesc'
  | 'expenseDaily'
  | 'expenseMonthly'
  | 'expenseYearly'
  | 'expenseThisMonth'
  | 'expenseThisYear'
  | 'expenseEmptyPeriod'
  | 'expenseAll'
  | 'expenseAllTotal'
  | 'deleteConfirmTitle'
  | 'deleteConfirmBody'
  | 'confirm'
  | 'pagePrev'
  | 'pageNext'
  | 'pageStatus'
  | 'stickerPrint'
  | 'stickerTitle'
  | 'stickerSize'
  | 'stickerSize38x25'
  | 'stickerSize50x25'
  | 'stickerSize50x30'
  | 'stickerSize40x30'
  | 'stickerQty'
  | 'stickerPerRow'
  | 'stickerPrintAction'
  | 'stickerPreview'
  | 'stickerNoBarcode'
  | 'stickerUnsupported'
  | 'stickerWide'
  | 'printersTitle'
  | 'printersNote'
  | 'printerReceipt'
  | 'printerReports'
  | 'printerLabels'
  | 'printerName'
  | 'printerNameHint'
  | 'receiptWidth'
  | 'receiptWidth58'
  | 'receiptWidth80'
  | 'reportsPaper'
  | 'reportsPaperA4'
  | 'reportsPaperLetter'
  | 'suppliersTitle'
  | 'supplierAdd'
  | 'editSupplier'
  | 'saveSupplier'
  | 'editSupplierFailed'
  | 'supplierSystemLocked'
  | 'suppliersColActions'
  | 'suppliersColPhone'
  | 'openSupplier'
  | 'viewPurchase'
  | 'supplierZeroBalance'
  | 'supplierName'
  | 'supplierContactName'
  | 'supplierContactNameOptional'
  | 'supplierPhone'
  | 'supplierPhoneOptional'
  | 'supplierAddress'
  | 'supplierAddressOptional'
  | 'supplierEmpty'
  | 'supplierEmptyDesc'
  | 'supplierAddFirst'
  | 'supplierNote'
  | 'supplierSearch'
  | 'supplierNoMatches'
  | 'supplierList'
  | 'supplierBack'
  | 'supplierReservedName'
  | 'supplierDue'
  | 'supplierGiven'
  | 'supplierBalance'
  | 'supplierPay'
  | 'supplierRequired'
  | 'supplierNone'
  | 'supplierNotFound'
  | 'supplierPaymentTooLarge'
  | 'supplierPayDate'
  | 'supplierNoteOptional'
  | 'supplierPayments'
  | 'supplierNoPayments'

  | 'purchasesTitle'
  | 'purchaseNew'
  | 'purchaseSupplier'
  | 'purchaseProduct'
  | 'purchasePieces'
  | 'purchaseLineAmount'
  | 'purchaseUnitCost'
  | 'purchaseAddLine'
  | 'purchaseSubtotal'
  | 'purchaseDiscount'
  | 'purchaseTotal'
  | 'purchasePaid'
  | 'purchaseDue'
  | 'purchaseSave'
  | 'purchaseEmpty'
  | 'purchaseAddProducts'
  | 'purchaseLines'
  | 'purchaseDate'
  | 'purchaseNote'
  | 'purchaseDiscountTooHigh'
  | 'purchasePaidTooHigh'
  | 'purchaseLinesRequired'
  | 'purchaseNotFound'
  | 'purchaseSearch'
  | 'purchaseClose'
  | 'purchaseScan'
  | 'purchaseScanHint'
  | 'purchaseLoose'
  | 'purchaseCarton'
  | 'purchaseQty'
  | 'purchaseCartons'
  | 'purchaseUnitsInside'
  | 'purchaseCartonCost'
  | 'purchaseStockIn'
  | 'purchaseList'
  | 'purchaseListSearch'
  | 'purchaseNoMatches'
  | 'purchaseEmptyDesc'
  | 'purchaseSelectHint'
  | 'purchaseOpen'
  | 'purchasesColPaid'
  | 'supplierInvoices'
  | 'supplierNoInvoices'
  | 'catalogColProduct'
  | 'catalogColPrice'
  | 'catalogColStock'
  | 'catalogColMargin'
  | 'catalogMarginHint'
  | 'catalogStockOut'
  | 'catalogStockLow'
  | 'catalogShowing'
  | 'catalogSelectHint'
  | 'partiesColCustomer'
  | 'partiesColPhone'
  | 'partiesColActions'
  | 'partiesSelectHint'
  | 'openKhata'
  | 'khataTotal'
  | 'khataPaid'
  | 'khataDue'
  | 'collect'
  | 'useFullDue'
  | 'save'
  | 'suppliersColSupplier'
  | 'suppliersSelectHint'
  | 'discountSection'
  | 'discountType'
  | 'discountNone'
  | 'discountPercent'
  | 'discountFixed'
  | 'discountPercentLabel'
  | 'discountAmountLabel'
  | 'discountStarts'
  | 'discountEnds'
  | 'discountWindowHint'
  | 'discountClear'
  | 'discountWillClear'
  | 'discountSalePrice'
  | 'discountSellingNow'
  | 'discountNormalPrice'
  | 'discountUntil'
  | 'discountUntilCleared'
  | 'discountStartsOn'
  | 'discountEndedOn'
  | 'discountBadge'
  | 'discountScheduledBadge'
  | 'invalidDiscountKind'
  | 'invalidDiscountPercent'
  | 'invalidDiscountAmount'
  | 'discountExceedsPrice'
  | 'invalidDiscountDate'
  | 'discountEndBeforeStart'
  | 'priceChanged'
  | 'pricesUpdated'
  | 'reportActions'
  | 'reportScope'
  | 'reportPrint'
  | 'reportPrintAction'
  | 'reportExcel'
  | 'reportClose'
  | 'reportPdfHint'
  | 'reportDownloaded'
  | 'reportDownloadFailed'
  | 'reportTitleToday'
  | 'reportTitleProfit'
  | 'reportPeriod'
  | 'reportGenerated'
  | 'reportTimezone'
  | 'reportSummary'
  | 'reportPosition'
  | 'reportItem'
  | 'reportValue'
  | 'reportAmount'
  | 'reportRevenue'
  | 'reportItemsSold'
  | 'reportUnitCost'
  | 'reportUnitPrice'
  | 'reportLineTotal'
  | 'reportRsSuffix'
  | 'reportNoRows'
  | 'reportFooter'
  | 'notifTitle'
  | 'notifEmpty'
  | 'notifEmptyDesc'
  | 'notifNew'
  | 'notifNewCount'
  | 'notifMore'
  | 'notifRefresh'
  | 'notifMarkAllSeen'
  | 'notifLoadFailed'
  | 'notifLoadPartial'
  | 'notifUpdatedAt'
  | 'notifSeverityUrgent'
  | 'notifSeverityWarning'
  | 'notifSeverityInfo'
  | 'notifOutTitle'
  | 'notifLowTitle'
  | 'notifStockLine'
  | 'notifSaleEndingTitle'
  | 'notifSaleEndingLine'
  | 'notifSupplierTitle'
  | 'notifCustomerTitle'
  | 'notifTaxTitle'
  | 'notifTaxDetail'
  | 'notifBackupNeverTitle'
  | 'notifBackupOldTitle'
  | 'notifBackupLast'
  | 'notifBackupDetail'
  | 'notifActionRestock'
  | 'notifActionCatalog'
  | 'notifActionSuppliers'
  | 'notifActionCustomers'
  | 'notifActionTax'
  | 'notifActionBackup'
  | 'saleTabsList'
  | 'saleTabEmpty'
  | 'saleTabBusy'
  | 'saleTabClose'
  | 'saleTabDiscardTitle'
  | 'saleTabDiscardConfirm'
  | 'saleTabDiscard'
  | 'saleTabsAtCap'
  | 'sellCustomerBar'
  | 'walkInDefault'
  | 'searchCustomersSell'
  | 'returnChange'
  | 'keepAsKhataCredit'
  | 'surplusChoiceHint'
  | 'surplusCredited'
  | 'surplusStaysOnKhata'
  | 'customerSelected'
  | 'clearCustomer'
  | 'newCustomerSell'
  | 'stockCountSearch'
  | 'stockCountTitle'
  | 'stockCountSystemQty'
  | 'stockCountCounted'
  | 'stockCountCancelTitle'
  | 'stockCountCancelBody'
  | 'stockCountPosted'
  | 'stockCountSkipped'
  | 'stockCountStartNew'
  | 'stockCountEmptyDesc'
  | 'stockCountDiscardDirty'
  | 'stockCountNothingToPost'
  | 'stockCountFailed'
  | 'stockCountCancelled'
  | 'stockCountResumeHint'
  | 'stockCountPostedNet'
  | 'stockCountApproveHint'
  | 'stockCountApproveBody'
  | 'stockCountApproveTitle'
  | 'stockCountApprove'
  | 'stockCountNoLines'
  | 'stockCountNoDiscrepancies'
  | 'stockCountStockChanged'
  | 'stockCountNotCountedPosted'
  | 'stockCountNotCountedNote'
  | 'stockCountRecount'
  | 'stockCountReasonAdminError'
  | 'stockCountReasonStolenLost'
  | 'stockCountReasonExpired'
  | 'stockCountReasonDamaged'
  | 'stockCountReasonNone'
  | 'stockCountColReason'
  | 'stockCountColValue'
  | 'stockCountColDiff'
  | 'stockCountColPhysical'
  | 'stockCountColSystem'
  | 'stockCountFilterDiscrepancies'
  | 'stockCountCardNetValue'
  | 'stockCountCardExtra'
  | 'stockCountCardMissing'
  | 'stockCountCardMatching'
  | 'stockCountReportTitle'
  | 'stockCountReviewTitle'
  | 'stockCountBackToDashboard'
  | 'stockCountBackToCounting'
  | 'stockCountBackToReview'
  | 'stockCountNotDraft'
  | 'stockCountNotFound'
  | 'stockCountNoneCounted'
  | 'stockCountAllCounted'
  | 'stockCountStatusNotCounted'
  | 'stockCountStatusCounted'
  | 'stockCountFilterCounted'
  | 'stockCountFilterUncounted'
  | 'stockCountFilterAll'
  | 'stockCountReviewSubmit'
  | 'stockCountCancelCount'
  | 'stockCountDraftSaved'
  | 'stockCountSaveDraft'
  | 'stockCountSaved'
  | 'stockCountSaving'
  | 'stockCountProgress'
  | 'stockCountInProgress'
  | 'stockCountNet'
  | 'stockCountPcs'
  | 'stockCountLoadMore'
  | 'stockCountViewReport'
  | 'stockCountStatusDraft'
  | 'stockCountStatusCompleted'
  | 'stockCountTypeQuick'
  | 'stockCountTypeFull'
  | 'stockCountColAction'
  | 'stockCountColStatus'
  | 'stockCountColDiscrepancy'
  | 'stockCountColType'
  | 'stockCountColDate'
  | 'stockCountHistoryEmptyDesc'
  | 'stockCountHistoryEmptyTitle'
  | 'stockCountHistoryTitle'
  | 'stockCountUncostedFootnote'
  | 'stockCountUncosted'
  | 'stockCountUncostedNote'
  | 'stockCountShrinkNote'
  | 'stockCountShrinkMonth'
  | 'stockCountItemsCounted'
  | 'stockCountItemsN'
  | 'stockCountCoverage'
  | 'stockCountDaysAgo'
  | 'stockCountOneDayAgo'
  | 'stockCountToday'
  | 'stockCountNever'
  | 'stockCountLastFullCount'
  | 'stockCountStartBlocked'
  | 'stockCountDraftDiscrepancies'
  | 'stockCountCoverageCounted'
  | 'stockCountDraftStarted'
  | 'stockCountDraftAlertTitle'
  | 'stockCountDiscard'
  | 'stockCountResumeDraft'
  | 'collapseNav'
  | 'expandNav'
  | 'settingsSalesTax'
  | 'settingsSalesTaxNote'
  | 'settingsSalesTaxEnable'
  | 'settingsSalesTaxStatusOn'
  | 'settingsSalesTaxStatusOff'
  | 'settingsSalesTaxRate'
  | 'settingsSalesTaxExample'
  | 'settingsSalesTaxSave'
  | 'settingsSalesTaxSaved'
  | 'settingsSalesTaxOnTitle'
  | 'settingsSalesTaxOnBody'
  | 'settingsSalesTaxOffTitle'
  | 'settingsSalesTaxOffBody'
  | 'settingsSalesTaxConfirmOn'
  | 'settingsSalesTaxConfirmOff'
  | 'taxRateRequired'
  | 'taxRateInvalid'
  | 'receiptSalesTaxIncl'
  | 'analyticsSalesTax'
  | 'analyticsTaxableBase'
  | 'taxTitle'
  | 'taxPeriod'
  | 'taxRatePercent'
  | 'taxSales'
  | 'taxAmount'
  | 'taxFrom'
  | 'taxTo'
  | 'taxPrevious'
  | 'taxInvalidRange'
  | 'navGroupSales'
  | 'navGroupInventory'
  | 'navGroupFinance'
  | 'navGroupSystem'
  | 'analyticsCashInTill'
  | 'analyticsTillCashSales'
  | 'analyticsTillUdhaarIn'
  | 'analyticsTillExpenses'
  | 'analyticsExpenses'
  | 'analyticsTopUdhaar'
  | 'analyticsTopUdhaarEmpty'
  | 'analyticsPaidDaysAgo'
  | 'analyticsPaidToday'
  | 'analyticsUnpaidDays'
  | 'analyticsSlowMovers'
  | 'analyticsSlowMoversEmpty'
  | 'analyticsStockValue'
  | 'analyticsShowAll'
  | 'analyticsShowLess'
  | 'analyticsUdhaarList'
  | 'analyticsTotalOwed'
  | 'analyticsRestock'
  | 'analyticsOutOfStock'
  | 'analyticsLowCount'
  | 'analyticsAllStocked'
  | 'analyticsLast7Amount'
  | 'analyticsWeekCompare'
  | 'analyticsThisWeek'
  | 'analyticsLastWeek'
  | 'analyticsNoChange'
  | 'analyticsSomeCostsMissing'
  | 'analyticsTopProfitItems'
  | 'analyticsProfitEmpty'
  | 'analyticsLowStockAll'
  | 'partiesOwedOnly'
  | 'partiesAllCustomers'
  | 'sellSearchPlaceholder'
  | 'sellNoItemMatch'
  | 'billTab'
  | 'newBill'
  | 'takePayment'
  | 'payCashReceived'
  | 'payAddToKhata'
  | 'pickCustomerHint'
  | 'returnChangeBig'
  | 'keepOnKhataInstead'
  | 'keptOnKhataNote'
  | 'remainderToKhata'
  | 'walkInShort'
  | 'noteExact'
  | 'noteKeys'
  | 'previousUdhaar'
  | 'advanceCredit'
  | 'qtyIncrease'
  | 'qtyDecrease'
  | 'enterAmountFirst'
  | 'salesTitle'
  | 'salesSearch'
  | 'salesFilterDate'
  | 'salesRangeToday'
  | 'salesRange7d'
  | 'salesRangeMonth'
  | 'salesRangeCustom'
  | 'salesFrom'
  | 'salesTo'
  | 'salesFilterPaid'
  | 'salesFilterStatus'
  | 'salesAll'
  | 'salesPaidCash'
  | 'salesPaidKhata'
  | 'salesPaidBoth'
  | 'salesStatusActive'
  | 'salesStatusRemoved'
  | 'salesStatusReturned'
  | 'salesTagReplaced'
  | 'salesTagReturned'
  | 'salesTagPartReturned'
  | 'salesSummaryBills'
  | 'salesColBill'
  | 'salesColTime'
  | 'salesColCustomer'
  | 'salesColItems'
  | 'salesColPaid'
  | 'salesColTotal'
  | 'salesNoBills'
  | 'salesLoadFailed'
  | 'salesBillDetail'
  | 'salesClose'
  | 'salesCashReceived'
  | 'salesChange'
  | 'salesKeptOnKhata'
  | 'salesReturnedQty'
  | 'salesReason'
  | 'salesReplacedBy'
  | 'salesReplaces'
  | 'salesReprint'
  | 'salesReprinted'
  | 'salesReprintFailed'
  | 'receiptCopy'
  | 'salesRemove'
  | 'salesRemoveTitle'
  | 'salesRemoveMsg'
  | 'salesReasonWrongItems'
  | 'salesReasonCancelled'
  | 'salesReasonDuplicate'
  | 'salesReasonOther'
  | 'salesRemoved'
  | 'salesRemoveFailed'
  | 'salesReturnItems'
  | 'salesEdit'
  | 'salesReturnsHeading'
  | 'returnsTitle'
  | 'returnsFind'
  | 'returnsNoBills'
  | 'returnsToday'
  | 'returnsNone'
  | 'returnsColItem'
  | 'returnsColSold'
  | 'returnsColReturn'
  | 'returnsBackToStock'
  | 'returnsRefund'
  | 'returnsRefundKhata'
  | 'returnsRefundCash'
  | 'returnsRefundBoth'
  | 'returnsConfirm'
  | 'returnsDone'
  | 'returnsFailed'
  | 'returnsGiveCash'
  | 'returnsOffKhata'
  | 'returnsNothingLeft'
  | 'returnsChangeBill'
  | 'returnsLoadFailed'
  | 'receiptReturn'
  | 'receiptReturnNo'
  | 'receiptOnBill'
  | 'receiptRefundCash'
  | 'receiptRefundKhata'
  | 'receiptReplaces'
  | 'posEditTab'
  | 'posAlreadyPaid'
  | 'posEditToCollect'
  | 'posEditGiveBack'
  | 'posEditSaved'
  | 'posEditFailed'
  | 'posEditSave'
  | 'sellLeaveOpenBills'
  | 'sellSignOutOpenBills'
  | 'activityLoadFailed'
  | 'plAddProduct'
  | 'plAmount'
  | 'plAriaPiecesEach'
  | 'plChargeName'
  | 'plCost'
  | 'plCostRs'
  | 'plDelivery'
  | 'plDeliveryExtraChargesRs'
  | 'plDiscount'
  | 'plEach'
  | 'plExtraCharges'
  | 'plOrdered'
  | 'plPaid'
  | 'plPaidSeparately'
  | 'plProduct'
  | 'plQty'
  | 'plRemaining'
  | 'plRemove'
  | 'plRemoveCharge'
  | 'plSalePrice'
  | 'plSubtotal'
  | 'plTotalRs'
  | 'poAriaPiecesPer'
  | 'poAriaPriceEach'
  | 'poAriaPricePer'
  | 'poAriaQty'
  | 'poAriaTotal'
  | 'poBack'
  | 'poBelowCost'
  | 'poBills'
  | 'poCancelConfirm'
  | 'poCancelOrder'
  | 'poChooseSupplierFor'
  | 'poCreateOrders'
  | 'poDate'
  | 'poDue'
  | 'poEdit'
  | 'poErrAddProduct'
  | 'poErrBulkByKg'
  | 'poErrCheckAmounts'
  | 'poErrCheckQty'
  | 'poErrCheckSalePrice'
  | 'poErrChooseSupplier'
  | 'poErrDiscountHigh'
  | 'poErrGeneric'
  | 'poErrOrderLocked'
  | 'poErrPackUnits'
  | 'poErrPaidHigh'
  | 'poErrProductNotFound'
  | 'poExpected'
  | 'poFromLowStock'
  | 'poHeadLanded'
  | 'poHeadPcsPack'
  | 'poHeadPriceRs'
  | 'poInStock'
  | 'poItems'
  | 'poLeaveUnsaved'
  | 'poLeaveTitle'
  | 'poLeaveYes'
  | 'poLeaveStay'
  | 'poLoading'
  | 'poMrp'
  | 'poNewOrder'
  | 'poNo'
  | 'poNoOrders'
  | 'poNoPhone'
  | 'poNoSupplierYet'
  | 'poNothingIsLow'
  | 'poOrderQty'
  | 'poOrdered'
  | 'poPhone'
  | 'poPick'
  | 'poProduct'
  | 'poReceive'
  | 'poReceived'
  | 'poRef'
  | 'poReorderAt'
  | 'poSave'
  | 'poSaveCloseOrder'
  | 'poSaveDraft'
  | 'poSaveSend'
  | 'poSendAgain'
  | 'poSendWhatsapp'
  | 'poStAll'
  | 'poStCancelled'
  | 'poStDraft'
  | 'poStOpen'
  | 'poStPartial'
  | 'poStReceived'
  | 'poStSent'
  | 'poStatus'
  | 'poSubtotalExpected'
  | 'poSuffixEach'
  | 'poSuffixPcs'
  | 'poSupplier'
  | 'poTabBills'
  | 'poTabNewBill'
  | 'poTabOrders'
  | 'poTabsAria'
  | 'poTitleEdit'
  | 'poTitleList'
  | 'poTitleReceive'
  | 'poWhatsappMessage'
  | 'ppApply'
  | 'ppApplyAll'
  | 'ppApplyN'
  | 'ppAriaApply'
  | 'ppAriaNewPrice'
  | 'ppCost2'
  | 'ppLoss'
  | 'ppMargin2'
  | 'ppMarkup'
  | 'ppMax'
  | 'ppNewPrice'
  | 'ppNotSaved'
  | 'ppNow'
  | 'ppPriceQ'
  | 'ppProduct'
  | 'ppSalePrices'
  | 'ppSkip'
  | 'psAdd'
  | 'psCancel'
  | 'psChooseSupplier'
  | 'psErrAdd'
  | 'psErrName'
  | 'psName'
  | 'psNewSupplierAltN'
  | 'psNoSupplier'
  | 'psPhone'
  | 'psSupplier'
  | 'rpActions'
  | 'rpBulkItem'
  | 'rpBulkStock'
  | 'rpCost'
  | 'rpCostEach'
  | 'rpCostPerUnit'
  | 'rpCsvBulk'
  | 'rpCsvCost'
  | 'rpCsvDate'
  | 'rpCsvMade'
  | 'rpCsvNo'
  | 'rpCsvNote'
  | 'rpCsvPacking'
  | 'rpCsvUndone'
  | 'rpCsvUsed'
  | 'rpCsvWastage'
  | 'rpCsvYes'
  | 'rpDate'
  | 'rpErrBulkCost'
  | 'rpErrLines'
  | 'rpErrNotEnough'
  | 'rpErrQty'
  | 'rpErrSameDay'
  | 'rpErrSave'
  | 'rpErrSold'
  | 'rpErrUndo'
  | 'rpErrUndone'
  | 'rpErrUsedLow'
  | 'rpErrWastage'
  | 'rpExcel'
  | 'rpHistory'
  | 'rpInStock'
  | 'rpLeft'
  | 'rpLoading'
  | 'rpMade'
  | 'rpNewRepack'
  | 'rpNoBulkItems'
  | 'rpNoPackedSizes'
  | 'rpNoRepacks'
  | 'rpNote'
  | 'rpOnlyInStock'
  | 'rpPacket'
  | 'rpPackets'
  | 'rpPackingPackRs'
  | 'rpRepack'
  | 'rpTotalCost'
  | 'rpUndo'
  | 'rpUndoConfirm'
  | 'rpUndone'
  | 'rpUsed'
  | 'rpWastage'
  | 'rpWastageUnit'
  | 'bkRestoreFull'
  | 'bkRestoreFullAsk'
  | 'bkRestoreFullDone'
  | 'errNotDbCopy'
  | 'errRestoreFailed'
  | 'tillsTitle'
  | 'tillsAdd'
  | 'tillsColTill'
  | 'tillsColName'
  | 'tillsColStatus'
  | 'tillsColShift'
  | 'tillsColToday'
  | 'tillsColSeen'
  | 'tillsOnline'
  | 'tillsOffline'
  | 'tillsNotPaired'
  | 'tillsOffState'
  | 'tillsPairCode'
  | 'tillsPairExpires'
  | 'tillsNewCode'
  | 'tillsRename'
  | 'tillsTurnOff'
  | 'tillsTurnOn'
  | 'tillsUsed'
  | 'tillsModeMain'
  | 'tillsModeServer'
  | 'tillsThisPc'
  | 'tillsShiftNone'
  | 'tillsOpenTill'
  | 'tillsBills'
  | 'tillsRenameTitle'
  | 'tillsTurnOffAsk'
  | 'tillsNewCodeAsk'
  | 'tillsModeAsk'
  | 'errTillLimit'
  | 'errTillShiftOpen'
  | 'errManagerOnly'
  | 'errNoTill'
  | 'errManagerApproval'
  | 'errNotManager'
  | 'errPairCode'
  | 'errPairExpired'
  | 'errTillOff'
  | 'approveTitle'
  | 'approveManager'
  | 'approvePin'
  | 'approveOk'
  | 'roleManager'
  | 'tillPick'
  | 'posOverrideTitle'
  | 'posOverridePrice'
  | 'posOverrideWas'
  | 'posOverrideKey'
  | 'rulesRefundManager'
  | 'linkDownTitle'
  | 'linkRetrying'
  | 'linkBillKept'
  | 'linkConnectTitle'
  | 'linkFound'
  | 'linkSearch'
  | 'linkSearching'
  | 'linkNoneFound'
  | 'linkAddress'
  | 'linkConnect'
  | 'linkPairTitle'
  | 'linkPairCode'
  | 'linkPairBtn'
  | 'linkDeviceName'
  | 'linkChangePc'
  | 'errBadAddress'
  | 'errServerUnreachable'
  | 'errNotDukaandesk'
  | 'errPairBad'
  | 'errTillNotPaired'
  | 'linkOffline'
  | 'linkSyncing'
  | 'linkSynced'
  | 'linkNotSent'
  | 'errOffline'
  | 'errOfflineCashOnly'
  | 'errOfflineItem'
  | 'errOfflineNumbers'
  | 'reviewTitle'
  | 'reviewColItem'
  | 'reviewColBill'
  | 'reviewColSold'
  | 'reviewColAfter'
  | 'reviewColNow'
  | 'reviewResolve'

/** English-only UI. Urdu appears only via UrHint and product names. */
export const dictionary: { en: Record<MessageKey, string> } = {
  en: {
    reviewResolve: 'Resolve',
    reviewColNow: 'Stock now',
    reviewColAfter: 'Stock after',
    reviewColSold: 'Sold',
    reviewColBill: 'Bill',
    reviewColItem: 'Item',
    reviewTitle: 'Stock review',
    errOfflineNumbers: 'Offline bill numbers used up',
    errOfflineItem: 'Item not available offline',
    errOfflineCashOnly: 'Cash only while offline',
    errOffline: 'Not available offline',
    linkNotSent: 'Not sent',
    linkSynced: 'Synced',
    linkSyncing: 'Sending',
    linkOffline: 'Offline',
    errTillNotPaired: 'This till is not paired',
    errPairBad: 'Wrong or expired code',
    errNotDukaandesk: 'Not a DukaanDesk Pro main PC',
    errServerUnreachable: 'Main PC not reachable',
    errBadAddress: 'Not a valid address',
    linkChangePc: 'Change main PC',
    linkDeviceName: 'This PC name',
    linkPairBtn: 'Pair',
    linkPairCode: 'Pairing code',
    linkPairTitle: 'Pair this till',
    linkConnect: 'Connect',
    linkAddress: 'Main PC address',
    linkNoneFound: 'None found',
    linkSearching: 'Searching',
    linkSearch: 'Search again',
    linkFound: 'Found on network',
    linkConnectTitle: 'Connect to main PC',
    linkBillKept: 'Open bill kept',
    linkRetrying: 'Retrying',
    linkDownTitle: 'Main PC not reachable',
    rulesRefundManager: 'Cashier refunds need a manager',
    posOverrideKey: 'Price',
    posOverrideWas: 'Was {rs}',
    posOverridePrice: 'New price',
    posOverrideTitle: 'Change price',
    tillPick: 'Till',
    roleManager: 'Manager',
    approveOk: 'Approve',
    approvePin: 'PIN',
    approveManager: 'Manager',
    approveTitle: 'Manager approval',
    errTillOff: 'Till is off',
    errPairExpired: 'Code expired',
    errPairCode: 'Wrong code',
    errNotManager: 'Not a manager',
    errManagerApproval: 'Manager approval needed',
    errNoTill: 'This PC is not a till',
    errManagerOnly: 'Manager only',
    errTillShiftOpen: 'Close the shift first',
    errTillLimit: 'Till limit reached',
    tillsModeAsk: 'Change main PC mode?',
    tillsNewCodeAsk: 'New code? The paired PC stops working.',
    tillsTurnOffAsk: 'Turn off this till?',
    tillsRenameTitle: 'Rename till',
    tillsBills: '{n} bills',
    tillsOpenTill: 'Open till',
    tillsShiftNone: 'Closed',
    tillsThisPc: 'This PC',
    tillsModeServer: 'Server only',
    tillsModeMain: 'Main PC sells',
    tillsUsed: '{used} of {limit} tills',
    tillsTurnOn: 'Turn on',
    tillsTurnOff: 'Turn off',
    tillsRename: 'Rename',
    tillsNewCode: 'New code',
    tillsPairExpires: 'Expires',
    tillsPairCode: 'Pairing code',
    tillsOffState: 'Off',
    tillsNotPaired: 'Not paired',
    tillsOffline: 'Offline',
    tillsOnline: 'Online',
    tillsColSeen: 'Last seen',
    tillsColToday: 'Today',
    tillsColShift: 'Shift',
    tillsColStatus: 'Status',
    tillsColName: 'Name',
    tillsColTill: 'Till',
    tillsAdd: 'Add till',
    tillsTitle: 'Tills',
    errRestoreFailed: 'Restore failed. Nothing changed.',
    errNotDbCopy: 'Not a full copy',
    bkRestoreFullDone: 'Restored',
    bkRestoreFullAsk: 'Replace all shop data with this copy?',
    bkRestoreFull: 'Restore',
    offersTitle: 'WhatsApp offers',
    offersFilterAll: 'All customers',
    offersFilterKhata: 'Has khata',
    offersFilterRecent: 'Bought in 30 days',
    offersFilterTop: 'Top buyers',
    offersSelectAll: 'Select all',
    offersKhata: 'Khata',
    offersLast30: 'Last 30 days',
    offersBadPhone: 'Bad number',
    offersNoPhone: 'No phone',
    waAddPhone: 'Add phone for WhatsApp',
    waFixPhone: 'Fix phone for WhatsApp',
    offersSelected: '{n} selected',
    offersWrite: 'Write message',
    offersTemplates: 'Templates',
    offersMessage: 'Message',
    offersTemplateName: 'Template name',
    offersSaveTemplate: 'Save template',
    offersStart: 'Start ({n})',
    offersInvalid: '{n} skipped: bad number',
    offersProgress: '{x} of {n}',
    offersSent: 'Sent',
    offersSkipped: 'Skipped',
    offersStop: 'Stop',
    offersSkip: 'Skip',
    offersOpen: 'Open WhatsApp',
    offersNext: 'Next',
    offersDone: '{x} of {n} sent',
    activityKindOffers: 'WhatsApp offers',
    themeDark: 'Dark Mode',
    themeLight: 'Light Mode',
    rulesLoyalty: 'Loyalty points',
    rulesLoyaltyRsPer: 'Rs spent for 1 point',
    rulesLoyaltyPointRs: '1 point is worth (Rs)',
    loyaltyPoints: 'Points',
    loyaltyUseAll: 'Use all',
    scaleRead: 'Scale',
    scaleReading: 'Reading…',
    scaleTitle: 'Weighing scale',
    scaleEnable: 'Use weighing scale on this PC',
    scalePort: 'Port',
    scaleBaud: 'Speed (baud)',
    scalePoll: 'Request command',
    scaleTest: 'Test reading',
    customerDisplay: 'Customer screen',
    waReminder: 'WhatsApp reminder',
    errScaleNoReading: 'No weight from the scale. Type the weight.',
    errScaleNoPort: 'Scale not found. Type the weight.',
    errScaleUnsupported: 'Scale not supported here. Type the weight.',
    errLoyaltyNotEnough: 'Not enough points',
    errLoyaltyNeedsCustomer: 'Pick a customer to use points',
    errLoyaltyOff: 'Loyalty points are off',
    errLoyaltyOverBill: 'Points are more than the bill',
    qtyWeight: 'Weight',
    qtyRsWorth: 'Rs worth',
    errRefundExceedsCash: 'Cash back can’t be more than the cash paid on this bill',
    errUdhaarNeedsCustomer: 'Pick a customer to leave a balance',
    saved: 'Saved',
    tillTitle: 'Till',
    tillOpenSince: 'Open since',
    tillCashIn: 'Cash in',
    tillCashOut: 'Cash out',
    tillClose: 'Close till',
    tillOpen: 'Open till',
    tillFloat: 'Opening float',
    tillCashSales: 'Cash sales',
    tillUdhaarReceived: 'Udhaar received',
    tillRefunds: 'Cash refunds',
    tillExpenses: 'Expenses',
    tillExpected: 'Expected in drawer',
    tillCounted: 'Counted cash',
    tillOverShort: 'Over / short',
    tillSales: 'Sales',
    tillUdhaarGiven: 'Udhaar given',
    tillReturns: 'Returns',
    tillMoves: 'Cash in / out',
    tillTime: 'Time',
    tillReason: 'Reason',
    tillUndo: 'Undo',
    tillHistory: 'Shift history',
    tillNoShifts: 'No shifts yet',
    tillOpened: 'Opened',
    tillClosed: 'Closed',
    tillOpenNow: 'Open',
    tillPrintZ: 'Z report',
    tillZTitle: 'Z report',
    tillExact: 'Exact',
    tillShort: 'Short',
    tillOver: 'Over',
    tillNote: 'Note',
    errTillAlreadyOpen: 'The till is already open',
    errTillNotOpen: 'Open the till first',
    errCashOutExceedsTill: 'Not that much cash in the till',
    errInvalidAmount: 'Enter an amount',
    errFolderNotAbsolute: 'Use a full folder path, e.g. E:\\Backups',
    errFolderNotWritable: 'Can’t write to that folder',
    errFolderRequired: 'Choose a folder first',
    errKeepCount: 'Keep 1 to 365 copies',
    errBackupBusy: 'A copy is being saved',
    errAutoBackupFailed: 'Copy failed',
    bkAutoTitle: 'Automatic daily copy',
    bkAutoLastFailed: 'Last copy failed',
    bkAutoLast: 'Last copy',
    bkAutoNever: 'No automatic copy yet',
    bkAutoEnable: 'Save a copy every day',
    bkAutoFolder: 'Folder or USB',
    bkAutoChoose: 'Choose…',
    bkAutoKeep: 'Copies to keep',
    bkAutoRunNow: 'Save a copy now',
    bkAutoFile: 'File',
    bkAutoSize: 'Size',
    staffPinShort: 'PIN',
    forgotPin: 'Forgot PIN?',
    recoveryCode: 'Recovery code',
    recoveryTitle: 'Owner recovery code',
    recoverySaved: 'I have saved this code',
    recoveryCopy: 'Copy',
    recoveryCopied: 'Copied',
    recoveryPrint: 'Print',
    recoveryDone: 'Done',
    recoverSetPin: 'Set new PIN',
    recoverBack: 'Back to sign in',
    recoveryNew: 'New recovery code',
    changeMyPin: 'Change PIN',
    badRecoveryCode: 'Recovery code not recognised',
    tooManyAttempts: 'Too many tries. Try again in a few minutes.',
    appName: 'DukaanDesk Pro',
    login: 'Login',
    pinLogin: 'PIN login',
    pin: 'PIN (4–6 digits)',
    confirmPin: 'Confirm PIN',
    signIn: 'Sign in',
    signOut: 'Sign out',
    owner: 'Owner',
    cashier: 'Cashier',
    cashierToday: 'Today',
    cashierTodayNote: 'Today’s sales (Asia/Karachi). No cost or margin.',
    cashierGoSell: 'Sell',
    cashierTodaySales: 'Today’s sales',
    cashierTodayEmpty: 'No sales yet today',
    ownerHome: 'Owner home',
    posShell: 'POS',
    catalog: 'Catalog',
    taxQueue: 'Tax queue',
    language: 'Language',
    langEn: 'EN',
    langUr: 'UR',
    paymentsNote: 'Payments: cash + udhaar + split',
    emptyCatalog: 'No products yet',
    healthOk: 'API healthy',
    healthFail: 'API unreachable',
    back: 'Back',
    selectUser: 'Select user',
    firstRunTitle: 'Set up your store',
    firstRunNote: 'Create the Owner account and your local store. PIN stays on this device.',
    displayName: 'Your name',
    storeName: 'Store name',
    storeNamePlaceholder: 'My Store',
    createOwner: 'Create owner',
    addProduct: 'Add product',
    productName: 'Product name',
    barcode: 'Barcode',
    barcodeOptional: 'Barcode (optional)',
    barcodeHint: 'Scan or type a manufacturer barcode. Leave blank and the shop makes a unique in-store one.',
    scanBarcode: 'Scan barcode',
    scanBarcodeEnter: 'Scanner types the code and sends Enter. Enter adds one piece.',
    barcodeNotFound: 'No product for that barcode',
    duplicateBarcode: 'That barcode is already on another product',
    invalidBarcode: 'Enter a valid barcode',
    priceRs: 'Price (Rs)',
    unit: 'Unit',
    unitPiece: 'Piece',
    unitPacket: 'Packet',
    unitKg: 'kg',
    unitGram: 'Gram',
    unitLitre: 'Litre',
    unitMl: 'ml',
    unitDozen: 'Dozen',
    unitPair: 'Pair',
    unitBox: 'Box',
    unitBottle: 'Bottle',
    unitCan: 'Can',
    unitJar: 'Jar',
    unitTin: 'Tin',
    unitTube: 'Tube',
    unitBar: 'Bar',
    unitSachet: 'Sachet',
    unitStrip: 'Strip',
    unitTray: 'Tray',
    unitRoll: 'Roll',
    unitBundle: 'Bundle',
    unitBag: 'Bag',
    unitMeter: 'Meter',
    unitFoot: 'Foot',
    unitCarton: 'Carton',
    productList: 'Products',
    loading: 'Loading…',
    onHand: 'On hand',
    qty: 'Quantity',
    piecesPerCarton: 'Pieces per carton',
    cashierStubNote: 'Cashier can sell cash / udhaar / split. Owner manages staff.',
    sell: 'Sell',
    addToCart: 'Add to sale',
    cart: 'Bill',
    cartEmpty: 'No items yet',
    cartTotal: 'Total',
    payCash: 'Pay cash',
    payUdhaar: 'Pay udhaar',
    paySheet: 'Complete sale',
    saleDone: 'Sale complete',
    saleId: 'Sale ID',
    newSale: 'New sale',
    insufficientStock: 'Not enough stock',
    cuStatCustomers: 'Customers',
    cuStatOwed: 'Total owed',
    cuStatOwing: 'Customers owing',
    cuStatOverLimit: 'Over limit',
    cuFilterClear: 'Clear',
    cuFilterOver: 'Over limit',
    cuSort: 'Sort',
    cuSortName: 'Name A–Z',
    cuSortBalance: 'Balance, highest first',
    cuSortNewest: 'Newest first',
    cuColLimit: 'Credit limit',
    cuColSince: 'Since',
    cuColEntry: 'Entry',
    cuColDebit: 'Udhaar',
    cuEntrySale: 'Udhaar sale',
    cuEntryDebit: 'Khata entry',
    cuEntryPayment: 'Payment received',
    cuReceivePayment: 'Receive payment',
    cuLimitUsed: '{pct}% of limit used',
    cuAdvance: 'Advance',
    cuEdit: 'Edit',
    sellShortage: 'Not enough stock: {items}. Add opening stock or a purchase first.',
    sellShortageLeft: '{n} left',
    errorWithCode: 'Could not complete ({code})',
    errDuplicateLine: 'The same item is on the bill twice',
    errForbidden: 'Not allowed for this login',
    errOwnerOnly: 'Only the owner can do this',
    errInvalidCreditLimit: 'Credit limit is not valid',
    errInvalidLine: 'A bill line is not valid',
    errInvalidPaid: 'Paid amount is not valid',
    errInvalidRange: 'Date range is not valid',
    errRangeTooLong: 'Date range is too long',
    errInvalidRefund: 'Refund amount is not valid',
    errRefundMismatch: 'Refund does not match the returned items',
    errInvalidStatus: 'Status is not valid',
    errKhataNeedsCustomer: 'Pick a customer to put this on khata',
    errMessageRequired: 'Type a message first',
    errQtyExceedsSold: 'Return quantity is more than was sold',
    errReasonRequired: 'Give a reason',
    errReplaceFailed: 'Could not save the edited bill',
    errSaleHasReturns: 'This bill has returns and cannot be changed',
    errSaleNotToday: 'Only bills from today can be opened here',
    errSaleVoided: 'This bill was removed',
    cashOnlyNote: 'Pay: cash only (this slice)',
    cashUdhaarNote: 'Walk-in: cash + change · Customer: remainder / keep surplus on khata',
    noSplitNote: 'Enter cash received; remainder can stay open or go on a customer khata.',
    splitPayNote: 'Cash received → remainder. Pick a customer above to put remainder or surplus on khata.',
    cashTendered: 'Cash received',
    changeToReturn: 'Change / to return',
    moreStillDue: 'More is still due',
    receiptPaid: 'Paid',
    receiptChange: 'Change / to return',
    remainder: 'Remainder (udhaar)',
    remainderNeedsParty: 'Remainder > 0 — customer optional for udhaar portion.',
    remainderOptionalParty:
      'Remainder stays on the sale for walk-in; with a customer selected it goes on their khata.',
    optionalCustomer: 'Customer (optional)',
    walkInCustomer: 'Walk-in (no customer)',
    sellCustomerBar: 'Customer',
    walkInDefault: 'Walk-in',
    searchCustomersSell: 'Search customer…',
    returnChange: 'Return change',
    keepAsKhataCredit: 'Keep on khata',
    surplusChoiceHint:
      'Cash is more than the total. Return the change, or keep it on this customer’s khata.',
    surplusCredited: 'Surplus credited',
    surplusStaysOnKhata: '{amount} stays on khata',
    customerSelected: 'Customer',
    clearCustomer: 'Clear',
    newCustomerSell: 'New customer',
    paySplit: 'Pay split',
    parties: 'Customers',
    partiesNote: 'Customer balances = ledger debits − credits',
    partyList: 'Customers',
    emptyParties: 'No customers yet',
    addFirstParty: 'Add your first customer',
    addParty: 'Add customer',
    editCustomer: 'Edit customer',
    saveCustomer: 'Save customer',
    editCustomerFailed: 'Could not update customer',
    partyName: 'Customer name',
    partyPhone: 'Phone (optional)',
    partyAddress: 'Address (optional)',
    searchParties: 'Search customers',
    partiesNoMatches: 'No matching customers',
    balance: 'Balance',
    udhaarParty: 'Customer',
    pickParty: 'Pick customer',
    createParty: 'Create customer',
    taxQueueNote: 'Simulate / queue only (D23). No live FBR.',
    taxPending: 'Pending',
    taxRejected: 'Rejected — decide',
    taxDispositionNote:
      'Void restores stock (+ reverses udhaar debit). Keep+flag leaves stock. Credit note is local queue only.',
    taxVoidSale: 'Void sale',
    taxKeepFlag: 'Keep + flag',
    taxCreditNote: 'Credit note',
    taxProcessNext: 'Process next',
    taxProcessed: 'Processed',
    taxQueueEmpty: 'Queue empty',
    backup: 'Backup',
    backupBadPin: 'Wrong PIN. Try again.',
    backupDataRegion: 'Data region',
    backupRestoreFailed: 'Could not restore. Your data was not changed.',
    bkNote: 'Keep a copy of your shop data safe.',
    bkChecking: 'Checking your last copy…',
    bkTryAgain: 'Try again',
    bkLastSaved: 'Last saved: {when}',
    bkNeverSaved: 'No copy saved yet. Save one now.',
    bkStale: 'No copy saved in {n} days. Save one now.',
    bkToday: 'Today, {time}',
    bkYesterday: 'Yesterday, {time}',
    bkStepsLabel: 'How it works',
    bkStep1: 'Save a copy',
    bkStep2: 'Put it on a USB',
    bkStep3: 'Restore it if something goes wrong',
    bkSaveTitle: 'Save a copy',
    bkSaveDesc: 'Saves your items, stock, customers, sales, purchases and expenses in one file.',
    bkPin: 'Your PIN',
    bkSaveNow: 'Save a copy now',
    bkSaving: 'Saving…',
    bkSaved: 'Saved ✓',
    bkSavedTo: 'Saved here:',
    bkSavedDownloads: 'Look in your Downloads folder for:',
    bkCopyPath: 'Copy path',
    bkPathCopied: 'Copied ✓',
    bkUsbTip: 'Tip: put this file on a USB and keep it away from this computer.',
    bkRestoreTitle: 'Restore from a copy',
    bkRestoreDesc: 'Brings your shop data back from a copy you saved.',
    bkRestoreEmpty: 'Pick a copy you saved earlier, e.g. from your USB.',
    bkChooseFile: 'Choose copy file',
    bkChangeFile: 'Choose another file',
    bkCopyFrom: 'Copy from {when}',
    bkCopyCounts: '{items} items · {customers} customers · {sales} sales',
    bkRestoreBtn: 'Restore this copy',
    bkConfirmTitle: 'Restore this copy?',
    bkConfirmMsg: 'This replaces today\'s data with the copy from {when}. Continue?',
    bkConfirmKeep: 'Your staff and PINs stay the same.',
    bkOldCopyNote: 'This is an older copy, so today\'s purchases, suppliers and expenses stay as they are.',
    bkSaveFirst: 'Save a copy of today\'s data first (recommended)',
    bkConfirmYes: 'Yes, restore',
    bkRestoring: 'Restoring…',
    bkRestored: 'Done ✓ Your shop data is back from the copy of {when}.',
    bkRestoredSafety: 'Today\'s data was saved first as:',
    bkSaveFirstStopped: 'Restore stopped because today\'s copy was not saved.',
    bkNotACopy: 'This file is not a DukaanDesk Pro copy. Pick another file.',
    bkWrongVersion: 'This copy can\'t be opened by this version of the app.',
    bkFileUnreadable: 'Could not read this file. Pick another file.',
    bkMore: 'More options',
    bkPasteLabel: 'Paste copy text instead of choosing a file',
    bkUsePasted: 'Use this text',
    bkStoredLocal: 'Copies stay on this computer or your USB. Nothing goes online.',
    bkLastRestored: 'Last restored: {when}',
    bkCopyVersion: 'Copy version: {n}',
    analytics: 'Analytics',
    analyticsNote: 'Today and last 7 days',
    analyticsToday: 'Today',
    analyticsLast7Days: 'Last 7 days',
    analyticsSalesTotal: 'Sales',
    analyticsCash: 'Cash',
    analyticsUdhaar: 'Udhaar',
    analyticsSaleCount: 'Sale count',
    analyticsTopProducts: 'Best sellers',
    analyticsLowStock: 'Low stock',
    analyticsLowStockEmpty: 'No low-stock items',
    analyticsUdhaarOutstanding: 'Udhaar outstanding',
    analyticsEmpty: 'No sales in this period',
    analyticsStockAlerts: 'Stock alerts',
    analyticsUnavailable: 'Analytics unavailable',
    retry: 'Retry',
    staff: 'Staff',
    staffNote: 'Add cashiers — PIN shown once. Soft-disable blocks login.',
    staffAddCashier: 'Add cashier',
    staffCreateCashier: 'Create cashier',
    staffUsers: 'Users',
    staffEmpty: 'No users yet',
    staffDeactivate: 'Disable',
    staffDisabled: 'Disabled',
    staffPinOnceTitle: 'Copy PIN now (shown once)',
    staffPinOnceNote: 'This PIN will not appear in the staff list again.',
    staffPinOnceDismiss: 'Got it',
    staffDeactivateConfirmYes: 'Disable',
    staffDeactivateConfirm: '{name} won’t be able to sign in.',
    staffPinCopied: 'Copied',
    staffPinCopy: 'Copy',
    staffPinHide: 'Hide',
    staffPinShow: 'Show',
    staffPinLabel: 'PIN',
    roleDataEntry: 'Data entry operator',
    roleHelper: 'Helper (no login)',
    salaryKindDue: 'Salary',
    salaryKindPayment: 'Paid',
    salaryKindAdvance: 'Advance',
    salaryKindDeduction: 'Advance cut',
    salaryKindBonus: 'Bonus',
    salaryRunDone: 'Salary added for {n} staff · {month}',
    payslipTitle: 'PAYSLIP',
    salaryBalance: 'Salary due',
    salaryAdvanceLeft: 'Advance left',
    payslipSignature: 'Signature',
    staffAdd: 'Add staff',
    staffEdit: 'Edit',
    staffSave: 'Save',
    staffPosition: 'Position',
    posCashier: 'Cashier',
    posSalesman: 'Salesman',
    posHelper: 'Helper',
    posStoreKeeper: 'Store keeper',
    posDataEntry: 'Data entry operator',
    posDelivery: 'Delivery boy',
    posManager: 'Manager',
    posOther: 'Other',
    posCustom: 'Custom position',
    staffMonthlySalary: 'Monthly salary',
    salaryVoidTitle: 'Undo this entry?',
    staffEnableTitle: 'Enable staff?',
    staffEnableConfirm: '{name} will be active again.',
    salaryVoid: 'Undo',
    staffEnable: 'Enable',
    staffResetPin: 'Reset PIN',
    staffNewPin: 'New PIN',
    salaryRun: 'Run salary',
    salaryMonth: 'Month',
    salaryRunNobody: 'No staff with a monthly salary',
    staffColSalary: 'Salary',
    salaryAdvanceCut: 'Advance cut',
    salaryPayable: 'Payable',
    salaryRunAdded: 'Added',
    salaryRunConfirm: 'Add salary',
    salaryPay: 'Pay salary',
    salaryGiveAdvance: 'Give advance',
    salaryAddBonus: 'Bonus',
    salaryPaidFrom: 'Paid from',
    salaryFromDrawer: 'Cash drawer',
    salaryOutsideDrawer: 'Outside drawer',
    staffBack: '← Staff',
    payslipPrint: 'Print payslip',
    salaryKhata: 'Payroll',
    salaryKhataEmpty: 'No entries yet',
    salaryEntry: 'Entry',
    salaryVoided: 'Undone',
    salaryKhataShort: 'Payroll',
    errSalaryOverBalance: 'More than salary due. Use Give advance.',
    errVoidSameDay: 'Only today’s entries can be undone',
    errNoLogin: 'This person has no login',
    errInvalidRole: 'Choose a role',
    errCannotChangeOwner: 'Owner can’t be changed here',
    errSalaryManagedInStaff: 'Salary entries are undone in Staff',
    errInvalidPeriod: 'Choose a month',
    searchStaff: 'Search staff',
    staffColName: 'Name',
    staffColRole: 'Role',
    staffColStatus: 'Status',
    staffActive: 'Active',
    staffNoMatches: 'No staff found',
    staffDeactivateTitle: 'Disable cashier?',
    receipt: 'Receipt',
    viewReceipt: 'View receipt',
    receiptPrint: 'Print',
    receiptShare: 'Share',
    receiptTotal: 'Total',
    receiptPayment: 'Payment',
    receiptCash: 'Cash',
    receiptUdhaar: 'Udhaar',
    receiptSplit: 'Split',
    receiptParty: 'Customer',
    receiptSaleId: 'Sale',
    receiptClientTime: 'Device time',
    receiptRecordedTime: 'Recorded',
    receiptShared: 'Shared',
    receiptCopied: 'Copied to clipboard',
    receiptShareFailed: 'Could not share',
    receiptPrinted: 'Receipt printed · {id}',
    receiptPrintFailed: 'Sale saved, but receipt did not print. Check the printer.',
    saleDoneFlash: 'Sale complete · {id} · {total}',
    receiptPrintAfterSale: 'Print receipt after each sale',
    receiptPrintAfterSaleHint: 'Needs a receipt printer name above. Uses the thermal printer when DukaanDesk Pro is running as the desktop app.',
    recordCollection: 'Record collection',
    collectNote: 'Cash pay-in against this customer’s udhaar balance.',
    collectAmountRs: 'Amount (Rs)',
    collectNoteOptional: 'Note (optional)',
    collectRecorded: 'Collection recorded',
    useFullDue: 'Use full due',
    save: 'Save',
    collectOverBalance: 'Amount is more than the outstanding balance',
    collectAmountInvalid: 'Enter an amount greater than zero',
    ledger: 'Ledger',
    ledgerDebit: 'Debit',
    ledgerCredit: 'Credit',
    emptyLedger: 'No ledger entries yet',
    zeroBalance: 'Balance is zero — nothing to collect',
    backToParties: 'Back to customers',
    backToPurchases: 'Back to purchases',
    partiesUnavailable: 'Customers unavailable',
    partyDetailUnavailable: 'Could not load customer',
    addPartyFailed: 'Could not add customer',
    collectFailed: 'Could not record collection',
    openParty: 'Open',
    searchProducts: 'Search products',
    estStock: 'Est. stock',
    softStock: 'Low / out of stock',
    payFullCash: 'Full cash',
    payAllUdhaar: 'All udhaar',
    taxQueued: 'Tax: queued',
    taxAccepted: 'Tax: accepted',
    saleFailed: 'Could not record sale',
    partyRequired: 'Customer not found',
    invalidQty: 'Enter a whole number greater than zero',
    invalidCashTendered: 'Enter a valid cash amount',
    catalogUnavailable: 'Catalog unavailable',
    emptyCatalogCashier: 'Ask the owner to add products',
    confirmSale: 'Complete sale',
    exactCash: 'Exact cash',
    settings: 'Settings',
    settingsNote: 'Store profile, PIN, tax mode, and about.',
    settingsStoreProfile: 'Store profile',
    settingsPhone: 'Phone',
    settingsAddress: 'Address',
    settingsReceiptFooter: 'Receipt footer',
    settingsLocaleDefault: 'Default language',
    settingsSave: 'Save store',
    settingsSaved: 'Store settings saved',
    settingsSaveFailed: 'Could not save settings',
    settingsChangePin: 'Change PIN',
    settingsCurrentPin: 'Current PIN',
    settingsNewPin: 'New PIN (4–6 digits)',
    settingsPinChanged: 'PIN updated',
    settingsPinBadCurrent: 'Current PIN is incorrect',
    settingsPinInvalid: 'PIN must be 4–6 digits',
    settingsPinMismatch: 'New PIN and confirm do not match',
    settingsPinFailed: 'Could not change PIN',
    settingsTaxMode: 'Tax mode',
    settingsTaxModeNote: 'Read-only. Simulate / queue only — no live FBR editors here.',
    settingsTaxSimulate: 'Simulate',
    settingsAbout: 'About',
    settingsSqlite: 'SQLite',
    settingsTabAccount: 'Account',
    searchCatalog: 'Search catalog',
    addFirstProduct: 'Add your first product',
    productNameEn: 'Name (English)',
    productNameUr: 'Name (Urdu)',
    addAnotherSize: 'Add another size',
    sizeQty: 'Size qty',
    activityKindSizes: 'Size prices',
    activityPurchaseOrders: 'Orders',
    repackTitle: 'Repack',
    activityRepack: 'Repack',
    sizePricesTitle: 'Update other sizes?',
    sizePricesAll: 'Update all',
    sizePricesOne: 'Only this one',
    sizeOldPrice: 'Old',
    sizeNewPrice: 'New',
    invalidSizeQty: 'Enter a size qty above 0',
    cartonPriceRs: 'Carton price (Rs)',
    piecePriceRs: 'Piece price (Rs)',
    cottonHelp: '"Cotton rate" means carton / pack price (not textile).',
    editProduct: 'Edit product',
    productPhoto: 'Picture',
    addPhoto: 'Add picture',
    changePhoto: 'Change picture',
    removePhoto: 'Remove picture',
    invalidImage: 'That picture could not be used. Try a JPG or PNG.',
    saveProduct: 'Save product',
    cancel: 'Cancel',
    catalogNoMatches: 'No matching products',
    goReceiveStock: 'Add stock in Purchases',
    askOwnerReceive: 'Ask the owner to receive stock',
    invalidName: 'Enter a product name',
    invalidPrice: 'Enter a valid price',
    invalidPiecesPerCarton: 'Pieces per carton must be at least 1',
    invalidUnit: 'Sell is pieces only',
    invalidUnitLabel: 'Choose a unit',
    addFailed: 'Could not add product',
    receiveFailed: 'Could not receive stock',
    cartonPriceSoon: 'Carton price saves when enabled',

    emptyStateCatalogTitle: 'No products yet',
    emptyStateCatalogDesc: 'Add a product to start selling from your catalog.',
    emptyStateCatalogCashierTitle: 'Catalog is empty',
    emptyStateCatalogCashierDesc: 'Ask the owner to add products before you sell.',
    emptyStatePartiesTitle: 'No customers yet',
    emptyStatePartiesDesc: 'Add a customer to track udhaar balances and collections.',
    emptyStateCashierTodayTitle: 'No sales yet today',
    emptyStateCashierTodayDesc: 'Open Sell to record your first sale of the day.',
    emptyStateTaxTitle: 'Tax queue is clear',
    emptyStateTaxDesc: 'Nothing waiting. Sales enqueue here after checkout — no stub actions on home.',
    emptyStateTaxBack: 'Back to catalog',
    emptyStateAnalyticsTitle: 'No sales yet',
    emptyStateAnalyticsDesc: 'Sell something or add products to see today’s numbers.',
    emptyStateStaffTitle: 'No staff yet',
    emptyStateStaffDesc: '',
    setupLanguage: 'Language',
    setupLanguageNote: 'Choose English or Urdu for this store. You can change it later in Settings.',
    sampleTitle: 'Add a sample product?',
    sampleNote: 'Optional: one kiryana item with stock so you can try Sell right away. Or skip for a blank catalog.',
    sampleAdd: 'Add sample',
    sampleSkip: 'Skip',
    sampleFailed: 'Could not add sample product',
    errorGeneric: 'Something went wrong',
    usersUnavailable: 'Could not load users',
    loginFailed: 'Could not sign in',
    invalidPin: 'PIN must be 4–6 digits',
    invalidDisplayName: 'Enter a name',
    invalidStoreName: 'Enter a valid store name',
    invalidLocale: 'Choose English or Urdu',
    alreadySetup: 'This store is already set up',
    notSetup: 'Set up the store first',
    userRequired: 'Select a user',
    pinMismatch: 'PIN and confirm do not match',
    setupFailed: 'Could not finish setup',
    staffUnavailable: 'Staff list unavailable',
    staffNameRequired: 'Enter a name',
    staffCreateFailed: 'Could not create cashier',
    staffDeactivateFailed: 'Could not disable cashier',
    cannotDisableOwner: 'Owner cannot be disabled',
    errorNotFound: 'Not found',
    backupUnavailable: 'Could not load backup info.',
    backupExportFailed: 'Could not save the copy. Try again.',
    settingsUnavailable: 'Settings unavailable',
    todayUnavailable: 'Today’s sales unavailable',
    cashierTodayUnavailable: 'Couldn’t load today’s sales',
    taxUnavailable: 'Tax queue unavailable',
    taxProcessFailed: 'Could not process the queue',
    taxDisposeFailed: 'Could not update this tax item',
    taxNotRejected: 'Only a rejected item can be decided',
    taxAlreadyDisposed: 'Already decided',
    saleAlreadyVoided: 'Sale is already voided',
    emptyCart: 'Sale is empty',
    invalidProduct: 'Invalid product',
    productNotFound: 'Product not found',
    partyNotAllowedCash: 'Customer not allowed for this payment',
    partyNotFound: 'Customer not found',
    invalidSplit: 'Cash and udhaar amounts do not match the total',
    partyNameRequired: 'Enter a customer name',
    partyNameTooLong: 'Customer name is too long',
    removeLine: 'Remove',
    taxReason: 'Reason',
    taxRef: 'Ref',
    taxStatusQueued: 'Queued',
    taxStatusSubmitting: 'Submitting',
    taxStatusVoided: 'Voided',
    taxStatusCreditNote: 'Credit note',
    taxStatusFlagged: 'Flagged',
    taxStatusPending: 'Pending',
    taxVoidedDone: 'Sale voided — stock restored',
    taxKeptFlagged: 'Kept and flagged',
    taxCreditQueued: 'Credit note queued',

    lastUnitCost: 'Last cost',
    costUnknown: 'Cost unknown',
    profitToday: 'Today profit',
    cogsToday: 'Cost of goods',
    grossProfit: 'Gross profit',
    markup: 'Markup',
    expensesTitle: 'Expenses',
    expenseBill: 'Bill',
    expenseSalary: 'Salary',
    expenseCommission: 'Commission',
    expenseAmountRs: 'Amount (Rs)',
    expenseDate: 'Date',
    expenseNote: 'Note',
    expenseNoteOptional: 'Note (optional)',
    expenseCategory: 'Category',
    expenseColAmount: 'Amount',
    expenseAdd: 'Add expense',
    expenseDelete: 'Delete',
    expenseToday: 'Today expenses',
    leftAfterExpenses: 'Left after expenses',
    profitUnknown: 'Add item costs to see profit',
    expenseFailed: 'Could not save expense',
    invalidAmount: 'Enter a number, zero or more. No letters or a minus',
    amountRequired: 'Enter the amount paid',
    invalidExpenseKind: 'Choose bill, salary, or commission',
    invalidDate: 'Enter a valid date',
    soldFor: 'Sold for',
    paidCost: 'Paid',
    lineProfit: 'Profit',
    sellPiecesOnly: 'Sell is pieces only',
    productAdded: 'Product added',
    expenseEmpty: 'No expenses yet',
    expenseEmptyDesc: 'Add bill, salary, or commission for this period.',
    expenseDaily: 'Daily',
    expenseMonthly: 'Monthly',
    expenseYearly: 'Yearly',
    expenseThisMonth: 'This month',
    expenseThisYear: 'This year',
    expenseEmptyPeriod: 'No expenses in this period',
    expenseAll: 'All',
    expenseAllTotal: 'All expenses',
    deleteConfirmTitle: 'Delete?',
    deleteConfirmBody: 'Delete {name}? This cannot be undone.',
    confirm: 'Confirm',
    pagePrev: 'Previous',
    pageNext: 'Next',
    pageStatus: 'Page {page} of {pages}',
    stickerPrint: 'Print stickers',
    stickerTitle: 'Barcode stickers',
    stickerSize: 'Label size',
    stickerSize38x25: '38 × 25 mm',
    stickerSize50x25: '50 × 25 mm',
    stickerSize50x30: '50 × 30 mm',
    stickerSize40x30: '40 × 30 mm',
    stickerQty: 'How many',
    stickerPerRow: 'Stickers per row',
    stickerPrintAction: 'Print',
    stickerPreview: 'Preview',
    stickerNoBarcode: 'This product has no barcode yet',
    stickerUnsupported: 'This barcode cannot be drawn',
    stickerWide: 'This row is wider than A4. Use fewer per row or a smaller label.',
    printersTitle: 'Printers',
    printersNote: 'The browser cannot see your printers. Save the name you use, plus the paper.',
    printerReceipt: 'Receipt printer',
    printerReports: 'Reports printer',
    printerLabels: 'Label printer',
    printerName: 'Printer name',
    printerNameHint: 'What you call it, for example XP-58',
    receiptWidth: 'Receipt width',
    receiptWidth58: '58 mm',
    receiptWidth80: '80 mm',
    reportsPaper: 'Reports paper',
    reportsPaperA4: 'A4',
    reportsPaperLetter: 'Letter',
    suppliersTitle: 'Suppliers',
    supplierAdd: 'Add supplier',
    editSupplier: 'Edit supplier',
    saveSupplier: 'Save supplier',
    editSupplierFailed: 'Could not update supplier',
    supplierSystemLocked: 'System supplier cannot be edited',
    supplierName: 'Supplier name',
    supplierContactName: 'Contact name',
    supplierContactNameOptional: 'Contact name (optional)',
    supplierPhone: 'Contact number',
    supplierPhoneOptional: 'Contact number (optional)',
    supplierAddress: 'Address',
    supplierAddressOptional: 'Address (optional)',
    supplierEmpty: 'No suppliers yet',
    supplierEmptyDesc: 'Add a supplier to track what you owe and what you have paid.',
    supplierAddFirst: 'Add your first supplier',
    supplierNote: 'Balance = due − given',
    supplierSearch: 'Search suppliers',
    supplierNoMatches: 'No matching suppliers',
    supplierList: 'Suppliers',
    supplierBack: 'Back to suppliers',
    supplierReservedName: 'No supplier is already on the list',
    supplierDue: 'Due',
    supplierGiven: 'Given',
    supplierBalance: 'Balance',
    supplierPay: 'Pay supplier',
    supplierRequired: 'Choose a supplier',
    supplierNone: 'No supplier',
    supplierNotFound: 'Supplier not found',
    supplierPaymentTooLarge: 'Payment is larger than the balance',
    supplierPayDate: 'Date',
    supplierNoteOptional: 'Note (optional)',
    supplierPayments: 'Payments',
    supplierNoPayments: 'No payments yet',
    purchasesTitle: 'Purchases',
    purchaseNew: 'New bill',
    purchaseSupplier: 'Supplier',
    purchaseProduct: 'Product',
    purchasePieces: 'Pieces',
    purchaseLineAmount: 'Line total',
    purchaseUnitCost: 'Cost per unit (Rs)',
    purchaseAddLine: 'Add line',
    purchaseSubtotal: 'Subtotal',
    purchaseDiscount: 'Discount (Rs)',
    purchaseTotal: 'Total',
    purchasePaid: 'Paid',
    purchaseDue: 'Remaining',
    purchaseSave: 'Save purchase',
    purchaseEmpty: 'No purchases yet',
    purchaseAddProducts: 'Add products',
    purchaseLines: 'Lines',
    purchaseDate: 'Date',
    purchaseNote: 'Note',
    purchaseDiscountTooHigh: 'Discount cannot exceed the subtotal',
    purchasePaidTooHigh: 'Paid cannot exceed the total',
    purchaseLinesRequired: 'Add at least one product',
    purchaseNotFound: 'Purchase not found',
    purchaseSearch: 'Search product',
    purchaseClose: 'Close',
    purchaseScan: 'Scan barcode',
    purchaseScanHint: 'Scan or type the barcode, then press Enter',
    purchaseLoose: 'Loose',
    purchaseCarton: 'Carton',
    purchaseQty: 'Quantity',
    purchaseCartons: 'Cartons',
    purchaseUnitsInside: 'Units in one carton',
    purchaseCartonCost: 'Cost per carton (Rs)',
    purchaseStockIn: 'Adds to stock',
    purchaseList: 'Purchase invoices',
    purchaseListSearch: 'Search purchases',
    purchaseNoMatches: 'No matching purchases',
    purchaseEmptyDesc: 'Record stock you buy from suppliers.',
    purchaseSelectHint: 'Open a purchase to see its lines.',
    purchaseOpen: 'Open',
    purchasesColPaid: 'Paid',
    supplierInvoices: 'Purchase invoices',
    supplierNoInvoices: 'No purchase invoices yet',
    catalogColProduct: 'Product',
    catalogColPrice: 'Price',
    catalogColStock: 'Stock',
    catalogColMargin: 'Margin',
    catalogMarginHint: 'Selling price now minus last cost, per unit',
    catalogStockOut: 'Out of stock',
    catalogStockLow: 'Low',
    catalogShowing: 'Showing {from}–{to} of {total}',
    catalogSelectHint: 'Select a product to edit it or print stickers.',
    partiesColCustomer: 'Customer',
    partiesColPhone: 'Phone',
    partiesColActions: 'Actions',
    openKhata: 'Khata',
    khataTotal: 'Total',
    khataPaid: 'Paid',
    khataDue: 'Due',
    collect: 'Collect',
    partiesSelectHint: 'Open Khata to view the ledger or record a collection.',
    suppliersColSupplier: 'Supplier',
    suppliersColPhone: 'Contact number',
    suppliersColActions: 'Actions',
    openSupplier: 'Open',
    viewPurchase: 'View',
    supplierZeroBalance: 'Nothing outstanding',
    suppliersSelectHint: 'Open a supplier to see purchases or record a payment.',
    discountSection: 'Discount',
    discountType: 'Discount type',
    discountNone: 'No discount',
    discountPercent: 'Percent off',
    discountFixed: 'Amount off (Rs)',
    discountPercentLabel: 'Percent off (%)',
    discountAmountLabel: 'Amount off per unit (Rs)',
    discountStarts: 'Starts (optional)',
    discountEnds: 'Ends (optional)',
    discountWindowHint: 'Store time (Asia/Karachi). Leave both empty to keep the discount on until you clear it. The sale stops at the end time.',
    discountClear: 'Clear discount',
    discountWillClear: 'The discount will be removed when you save.',
    discountSalePrice: 'Sale price',
    discountSellingNow: 'Selling price now',
    discountNormalPrice: 'Normal price',
    discountUntil: 'Sale until {date}',
    discountUntilCleared: 'On sale until you clear it',
    discountStartsOn: 'Sale starts {date}',
    discountEndedOn: 'Sale ended {date}. The normal price applies.',
    discountBadge: 'Sale',
    discountScheduledBadge: 'Scheduled',
    invalidDiscountKind: 'Pick a discount type.',
    invalidDiscountPercent: 'Enter a percent from 0 to 100.',
    invalidDiscountAmount: 'Enter a valid discount amount.',
    discountExceedsPrice: 'The discount cannot be more than the price.',
    invalidDiscountDate: 'Enter a valid date and time.',
    discountEndBeforeStart: 'The end must be after the start.',
    priceChanged: 'Prices changed since these items were added (a discount started or ended). The bill shows the new prices. Check the total and take payment again.',
    pricesUpdated: 'Prices updated because a discount started or ended. Check the total, then take payment again.',
    reportActions: 'Reports',
    reportScope: 'Excel and PDF for the {tab} tab',
    reportPrint: 'Print / PDF',
    reportPrintAction: 'Print',
    reportExcel: 'Excel',
    reportClose: 'Close',
    reportPdfHint: 'For a PDF, pick Save as PDF or Microsoft Print to PDF in the print window.',
    reportDownloaded: 'Downloaded {file}',
    reportDownloadFailed: 'Could not create the file. Try again.',
    reportTitleToday: 'Sales report',
    reportTitleProfit: 'Profit report',
    reportPeriod: 'Period',
    reportGenerated: 'Generated',
    reportTimezone: 'Time zone',
    reportSummary: 'Summary',
    reportPosition: 'Udhaar and stock',
    reportItem: 'Item',
    reportValue: 'Value',
    reportAmount: 'Amount',
    reportRevenue: 'Revenue',
    reportItemsSold: 'Items sold today',
    reportUnitCost: 'Paid per unit',
    reportUnitPrice: 'Sold for per unit',
    reportLineTotal: 'Line total',
    reportRsSuffix: '(Rs)',
    reportNoRows: 'Nothing to show',
    reportFooter: 'DukaanDesk Pro · from local data on this computer',
    notifTitle: 'Notifications',
    notifEmpty: 'All clear',
    notifEmptyDesc: 'No stock, sale, payment, tax, or backup alerts right now.',
    notifNew: 'New',
    notifNewCount: '{n} new',
    notifMore: '+{n} more',
    notifRefresh: 'Refresh',
    notifMarkAllSeen: 'Mark all seen',
    notifLoadFailed: 'Could not refresh alerts. Showing what we have.',
    notifLoadPartial: 'Some alerts could not refresh. Showing the last good list.',
    notifUpdatedAt: 'Updated {time}',
    notifSeverityUrgent: 'Urgent',
    notifSeverityWarning: 'Warning',
    notifSeverityInfo: 'Info',
    notifOutTitle: 'Out of stock ({n})',
    notifLowTitle: 'Low stock, {threshold} or less ({n})',
    notifStockLine: '{name} · {qty} left',
    notifSaleEndingTitle: 'Sales ending within 48 hours ({n})',
    notifSaleEndingLine: '{name} ends {date}',
    notifSupplierTitle: 'Supplier payments due · {amount}',
    notifCustomerTitle: 'Customer udhaar outstanding · {amount}',
    notifTaxTitle: 'Tax invoices rejected ({n})',
    notifTaxDetail: 'Decide what to do with each one in the tax queue.',
    notifBackupNeverTitle: 'No copy saved yet',
    notifBackupOldTitle: 'No copy saved in {n} days',
    notifBackupLast: 'Last saved {date}.',
    notifBackupDetail: 'Save a copy when you can.',
    notifActionRestock: 'Restock in Purchases',
    notifActionCatalog: 'Open Catalog',
    notifActionSuppliers: 'Pay in Suppliers',
    notifActionCustomers: 'Open Customers',
    notifActionTax: 'Open Tax queue',
    notifActionBackup: 'Open Backup',
    saleTabsList: 'Open bills',
    saleTabEmpty: 'Sale {n}',
    saleTabBusy: '{name} · {count} · {total}',
    saleTabClose: 'Close bill',
    saleTabDiscardTitle: 'Discard bill?',
    saleTabDiscardConfirm: 'This bill still has items. Discard it?',
    saleTabDiscard: 'Discard',
    saleTabsAtCap: 'You already have {n} open bills. Finish or close one first.',
    stockCountSearch: 'Search product',
    stockCountTitle: 'Stock count',
    stockCountSystemQty: 'System Qty',
    stockCountCounted: 'Counted',
    stockCountCancelTitle: 'Cancel stock count?',
    stockCountCancelBody: 'Discard this count? On-hand stock will not change.',
    stockCountPosted: 'Stock updated · {n} adjusted · {delta} pcs changed',
    stockCountSkipped: '{n} matched system (no change).',
    stockCountStartNew: 'Start new',
    stockCountEmptyDesc: 'Add Products In Catalog Before Counting Stock.',
    stockCountDiscardDirty: 'Some counts are still saving. Leave anyway?',
    stockCountNothingToPost: 'Count at least one item first.',
    stockCountFailed: 'Stock count failed. Try again.',
    stockCountCancelled: 'Draft cancelled.',
    stockCountResumeHint: 'A draft count is already open — resume or discard it.',
    stockCountResumeDraft: 'Resume draft',
    stockCountDiscard: 'Discard',
    stockCountDraftAlertTitle: 'Draft in progress',
    stockCountDraftStarted: 'Started {when}',
    stockCountCoverageCounted: '{x} / {y} counted',
    stockCountDraftDiscrepancies: '{n} discrepancies so far',
    stockCountStartBlocked: 'One Draft At A Time — Resume Or Discard It Before Starting A New Count.',
    stockCountLastFullCount: 'Last full count',
    stockCountNever: 'Never',
    stockCountToday: 'Today',
    stockCountOneDayAgo: '1 day ago',
    stockCountDaysAgo: '{n} days ago',
    stockCountCoverage: '{x} / {y} items',
    stockCountItemsN: '{n} items',
    stockCountItemsCounted: 'Items counted',
    stockCountShrinkMonth: 'Shrinkage this month',
    stockCountShrinkNote: 'Losses only, at last cost',
    stockCountUncostedNote: '{n} uncosted',
    stockCountUncosted: 'Uncosted',
    stockCountUncostedFootnote: 'Uncosted items (not in Rs total): {n}',
    stockCountHistoryTitle: 'Recent counts',
    stockCountHistoryEmptyTitle: 'No stock counts yet',
    stockCountHistoryEmptyDesc: 'Count Your Shelves To Match System Stock. Start A New Count To Begin.',
    stockCountColDate: 'Date',
    stockCountColType: 'Type',
    stockCountColDiscrepancy: 'Discrepancy',
    stockCountColStatus: 'Status',
    stockCountColAction: 'Action',
    stockCountTypeFull: 'Full',
    stockCountTypeQuick: 'Quick',
    stockCountStatusCompleted: 'Completed',
    stockCountStatusDraft: 'Draft',
    stockCountViewReport: 'View report',
    stockCountLoadMore: 'Load more',
    stockCountPcs: '{n} pcs',
    stockCountNet: 'Net {n}',
    stockCountInProgress: 'Stock count in progress',
    stockCountProgress: 'Items counted {x} / {y}',
    stockCountSaving: 'Saving…',
    stockCountSaved: 'Saved',
    stockCountSaveDraft: 'Save as draft',
    stockCountDraftSaved: 'Draft saved. Resume any time.',
    stockCountCancelCount: 'Cancel count',
    stockCountReviewSubmit: 'Review & submit',
    stockCountFilterAll: 'All',
    stockCountFilterUncounted: 'Uncounted',
    stockCountFilterCounted: 'Counted',
    stockCountStatusCounted: 'Counted',
    stockCountStatusNotCounted: 'Not counted',
    stockCountAllCounted: 'Every product is counted.',
    stockCountNoneCounted: 'Nothing counted yet.',
    stockCountNotFound: 'Not found: {code}',
    stockCountNotDraft: 'This count is no longer a draft.',
    stockCountBackToReview: 'Back to review',
    stockCountBackToCounting: 'Back to counting',
    stockCountBackToDashboard: 'Back to dashboard',
    stockCountReviewTitle: 'Variance & review',
    stockCountReportTitle: 'Stock count report',
    stockCountCardMatching: 'Matching',
    stockCountCardMissing: 'Missing',
    stockCountCardExtra: 'Extra',
    stockCountCardNetValue: 'Net value',
    stockCountFilterDiscrepancies: 'Discrepancies only',
    stockCountColSystem: 'System',
    stockCountColPhysical: 'Physical',
    stockCountColDiff: 'Difference',
    stockCountColValue: 'Value',
    stockCountColReason: 'Reason',
    stockCountReasonNone: 'No reason',
    stockCountReasonDamaged: 'Damaged',
    stockCountReasonExpired: 'Expired',
    stockCountReasonStolenLost: 'Stolen/lost',
    stockCountReasonAdminError: 'Admin error',
    stockCountRecount: 'Re-count item',
    stockCountNotCountedNote: '{n} items not counted — they will not change.',
    stockCountNotCountedPosted: '{n} items were not counted and did not change.',
    stockCountStockChanged: 'On-Hand Changed To {n} Since Counted; Posting Sets It To Counted.',
    stockCountNoDiscrepancies: 'No discrepancies — every counted item matches.',
    stockCountNoLines: 'No counted items.',
    stockCountApprove: 'Approve & update POS stock',
    stockCountApproveTitle: 'Update POS stock?',
    stockCountApproveBody: '{n} Items Will Change; {m} Unchanged Items Skipped. Uncounted Items Stay As They Are. This Cannot Be Undone.',
    stockCountApproveHint: '{n} will change · {m} match',
    stockCountPostedNet: 'Net value {v}',
    collapseNav: 'Collapse menu',
    expandNav: 'Expand menu',
    settingsSalesTax: 'Sales tax',
    settingsSalesTaxNote: 'Off By Default. When On, Tax Is Taken Out Of Your Shelf Prices — Customers Pay The Same Total.',
    settingsSalesTaxEnable: 'Enable sales tax (included in prices)',
    settingsSalesTaxStatusOn: 'Currently on · {rate}%',
    settingsSalesTaxStatusOff: 'Currently off — no tax on sell or receipts',
    settingsSalesTaxRate: 'Tax rate (%)',
    settingsSalesTaxExample: 'Example: a {price} item includes {tax} tax',
    settingsSalesTaxSave: 'Save sales tax',
    settingsSalesTaxSaved: 'Sales tax saved',
    settingsSalesTaxOnTitle: 'Turn on sales tax?',
    settingsSalesTaxOnBody: 'Your Shelf Prices Stay The Same. {rate}% Sales Tax Will Be Taken Out Of Each Price And Shown On Receipts. If Your Prices Do Not Include Tax Yet, Raise Them First.',
    settingsSalesTaxOffTitle: 'Turn off sales tax?',
    settingsSalesTaxOffBody: 'New Sales Will Have No Tax Line. Past Receipts Keep The Tax They Were Sold With.',
    settingsSalesTaxConfirmOn: 'Turn on',
    settingsSalesTaxConfirmOff: 'Turn off',
    taxRateRequired: 'Enter a tax rate above 0% before turning sales tax on',
    taxRateInvalid: 'Tax rate must be 0–100% with up to 2 decimals',
    receiptSalesTaxIncl: 'Incl. Sales Tax',
    analyticsSalesTax: 'Sales tax (incl.)',
    analyticsTaxableBase: 'Taxable base',
    taxTitle: 'Tax',
    taxPeriod: 'Period',
    taxRatePercent: 'Rate %',
    taxSales: 'Sales',
    taxAmount: 'Tax',
    taxFrom: 'From',
    taxTo: 'To',
    taxPrevious: 'Previous years',
    taxInvalidRange: 'Invalid range',
    navGroupSales: 'Sales',
    navGroupInventory: 'Inventory',
    navGroupFinance: 'Finance',
    navGroupSystem: 'System',
    analyticsCashInTill: 'Cash in till',
    analyticsTillCashSales: 'Cash sales',
    analyticsTillUdhaarIn: 'Udhaar received',
    analyticsTillExpenses: 'Expenses',
    analyticsExpenses: 'Expenses',
    analyticsTopUdhaar: 'Who owes most',
    analyticsTopUdhaarEmpty: 'Nobody owes money',
    analyticsPaidDaysAgo: 'Paid {days} days ago',
    analyticsPaidToday: 'Paid today',
    analyticsUnpaidDays: 'Unpaid for {days} days',
    analyticsSlowMovers: 'Not sold in 30 days',
    analyticsSlowMoversEmpty: 'Everything sold in the last 30 days',
    analyticsStockValue: 'Stock value',
    analyticsShowAll: 'Show all ({count})',
    analyticsShowLess: 'Show less',
    analyticsUdhaarList: 'View udhaar list',
    analyticsTotalOwed: 'Total owed',
    analyticsRestock: 'Restock',
    analyticsOutOfStock: '{count} out of stock',
    analyticsLowCount: '{count} low',
    analyticsAllStocked: 'All stocked',
    analyticsLast7Amount: 'Last 7 days: {amount}',
    analyticsWeekCompare: 'This week vs last week',
    analyticsThisWeek: 'This week',
    analyticsLastWeek: 'Last week',
    analyticsNoChange: 'Same as last week',
    analyticsSomeCostsMissing: 'Some items have no cost',
    analyticsTopProfitItems: 'Top items by profit',
    analyticsProfitEmpty: 'No profit to show yet',
    analyticsLowStockAll: 'Low stock items',
    partiesOwedOnly: 'Owes money',
    partiesAllCustomers: 'All customers',
    sellSearchPlaceholder: 'Scan or search item',
    sellNoItemMatch: 'No item found',
    billTab: 'Bill {n}',
    newBill: 'New bill',
    takePayment: 'Take payment',
    payCashReceived: 'Cash received',
    payAddToKhata: 'Add to khata',
    pickCustomerHint: 'Pick a customer',
    returnChangeBig: 'Return: {amount}',
    keepOnKhataInstead: 'Keep {amount} on khata instead',
    keptOnKhataNote: '{amount} goes to khata as credit',
    remainderToKhata: '{amount} goes to khata',
    walkInShort: 'Short by {amount}',
    noteExact: 'Exact',
    noteKeys: 'Notes',
    previousUdhaar: 'Previous udhaar: {amount}',
    advanceCredit: 'Advance: {amount}',
    qtyIncrease: 'One more',
    qtyDecrease: 'One less',
    enterAmountFirst: 'Enter cash first',
    salesTitle: 'Sales',
    salesSearch: 'Bill no, customer, item or amount',
    salesFilterDate: 'Date',
    salesRangeToday: 'Today',
    salesRange7d: '7 days',
    salesRangeMonth: 'This month',
    salesRangeCustom: 'Custom',
    salesFrom: 'From',
    salesTo: 'To',
    salesFilterPaid: 'Paid by',
    salesFilterStatus: 'Status',
    salesAll: 'All',
    salesPaidCash: 'Cash',
    salesPaidKhata: 'Khata',
    salesPaidBoth: 'Cash + khata',
    salesStatusActive: 'Completed',
    salesStatusRemoved: 'Removed',
    salesStatusReturned: 'Returned',
    salesTagReplaced: 'Replaced',
    salesTagReturned: 'Returned',
    salesTagPartReturned: 'Part returned',
    salesSummaryBills: '{count} bills',
    salesColBill: 'Bill',
    salesColTime: 'Time',
    salesColCustomer: 'Customer',
    salesColItems: 'Items',
    salesColPaid: 'Paid by',
    salesColTotal: 'Total',
    salesNoBills: 'No bills found',
    salesLoadFailed: 'Could not load bills',
    salesBillDetail: 'Bill details',
    salesClose: 'Close',
    salesCashReceived: 'Cash received',
    salesChange: 'Change returned',
    salesKeptOnKhata: 'Kept on khata',
    salesReturnedQty: '{qty} returned',
    salesReason: 'Reason',
    salesReplacedBy: 'Replaced by',
    salesReplaces: 'Replaces',
    salesReprint: 'Reprint',
    salesReprinted: 'Copy printed · {id}',
    salesReprintFailed: 'Receipt did not print. Check the printer.',
    receiptCopy: 'COPY',
    salesRemove: 'Remove',
    salesRemoveTitle: 'Remove bill #{id}?',
    salesRemoveMsg: 'Items go back to stock.',
    salesReasonWrongItems: 'Wrong items',
    salesReasonCancelled: 'Customer cancelled',
    salesReasonDuplicate: 'Duplicate',
    salesReasonOther: 'Other',
    salesRemoved: 'Bill #{id} removed',
    salesRemoveFailed: 'Could not remove the bill',
    salesReturnItems: 'Return items',
    salesEdit: 'Edit',
    salesReturnsHeading: 'Returns',
    returnsTitle: 'Returns',
    returnsFind: 'Scan receipt, bill no or customer',
    returnsNoBills: 'No bills found',
    returnsToday: 'Today\'s returns',
    returnsNone: 'No returns today',
    returnsColItem: 'Item',
    returnsColSold: 'Sold',
    returnsColReturn: 'Return',
    returnsBackToStock: 'Back to stock',
    returnsRefund: 'Refund',
    returnsRefundKhata: 'Khata',
    returnsRefundCash: 'Cash',
    returnsRefundBoth: 'Cash + khata',
    returnsConfirm: 'Return {amount}',
    returnsDone: 'Return {id} saved',
    returnsFailed: 'Could not save the return',
    returnsGiveCash: 'Give cash',
    returnsOffKhata: 'Off khata',
    returnsNothingLeft: 'All items already returned',
    returnsChangeBill: 'Change bill',
    returnsLoadFailed: 'Could not load',
    receiptReturn: 'RETURN',
    receiptReturnNo: 'Return',
    receiptOnBill: 'Bill',
    receiptRefundCash: 'Cash back',
    receiptRefundKhata: 'Off khata',
    receiptReplaces: 'Replaces #{id}',
    posEditTab: 'Edit #{id}',
    posAlreadyPaid: 'Already paid',
    posEditToCollect: 'To collect',
    posEditGiveBack: 'Give back',
    posEditSaved: 'Bill #{new} replaces #{old}',
    posEditFailed: 'Could not save the edit',
    sellLeaveOpenBills: 'You have {n} open bill(s) with items. Leaving Sell will clear them. Leave anyway?',
    sellSignOutOpenBills: 'You have {n} open bill(s) with items on Sell. Signing out will clear them. Sign out anyway?',
    activityLoadFailed: 'Could not load activity',
    posEditSave: 'Save edit',
    creditOverLimit: "Over credit limit: balance {balance}, limit {limit}",
    payType: "Payment type",
    payTypeCash: "Cash",
    payRef: "Ref no.",
    payReceived: "received",
    billDiscount: "Discount",
    billRounding: "Rounding",
    billSubtotal: "Subtotal",
    discountOverLimit: "Cashier discount limit is {max}%",
    packUnit: "Sell by",
    packPiece: "Piece",
    packDozen: "Dozen",
    packCarton: "Carton",
    creditAllowOnce: "Allow this time",
    errDiscountOverLimit: "Discount is over the cashier limit",
    errCreditLimitExceeded: "Customer is over the credit limit",
    errInvalidDigital: "Check the JazzCash / Easypaisa / bank amount",
    errInvalidDiscount: "Check the discount",
    errUndoSameDay: "Undo works on the same day only",
    errUndoStockSold: "Items from this return are already sold again",
    errInvalidExpiry: "Check the expiry date",
    errNoRows: "No rows found in the file",
    stockCare: "Stock alerts",
    writeOffNew: "Write off",
    reorderTitle: "Reorder",
    expiryTitle: "Near expiry",
    writeOffsTitle: "Write-offs",
    reorderEmpty: "Nothing below reorder level",
    reorderMakePurchase: "Make purchase",
    colItem: "Item",
    reorderLevel: "Reorder level",
    reorderSuggest: "Buy",
    expiryEmpty: "Nothing expiring in {days} days",
    expiryDate: "Expiry",
    batchNo: "Batch",
    expiryLeft: "Left",
    expiredChip: "Expired",
    expiryDaysLeft: "{n} days",
    writeOffAction: "Write off",
    expiryDismiss: "Dismiss",
    writeOffsEmpty: "No write-offs",
    writeOffsValue: "Value",
    writeOffExpired: "Expired",
    writeOffDamaged: "Damaged",
    writeOffPick: "Pick an item",
    note: "Note",
    expiryDismissMsg: "Remove this batch from the expiry list?",
    errQtyExceedsStock: "More than in stock",
    activityTitle: "Activity",
    activityAll: "All",
    activitySales: "Sales",
    activityVoids: "Voids & edits",
    activityReturns: "Returns",
    activityPrices: "Price changes",
    activityWriteOffs: "Write-offs",
    activityPurchases: "Purchases",
    activityKindSale: "Sold",
    activityKindVoid: "Voided",
    activityKindEdit: "Edited bill",
    activityKindReturn: "Return",
    activityKindReturnUndo: "Return undone",
    activityKindPrice: "Price change",
    activityKindWriteOff: "Write-off",
    activityKindPurchase: "Purchase",
    activityKindExpense: "Expense",
    activityWho: "Who",
    activityEveryone: "Everyone",
    activityDay: "Day",
    activityEmpty: "Nothing yet",
    activityWhat: "What",
    activitySubject: "Bill / item",
    amount: "Amount",
    shortcutsTitle: "Keyboard shortcuts",
    shortcutsSell: "Sell",
    shortcutsPay: "Payment",
    shortcutsGeneral: "Anywhere",
    close: "Close",
    rulesTitle: "Shop rules",
    rulesRounding: "Round bill total",
    rulesRoundOff: "Off",
    rulesCashierDiscount: "Cashier max bill discount (%)",
    rulesCreditMode: "Over credit limit",
    rulesCreditWarn: "Warn",
    rulesCreditBlock: "Block (owner can allow)",
    rulesExpiryDays: "Expiry alert (days before)",
    rulesDrawerKick: "Open cash drawer after cash sale",
    creditLimit: "Credit limit (Rs)",
    creditLimitNone: "No limit",
    importTitle: "Import",
    importColumns: "Excel (.xlsx) or CSV. Columns: name, price, barcode, unit, cost, stock, reorder, name_ur",
    importToAdd: "{n} new",
    importSkipped: "{n} already there",
    importErrors: "{n} with problems",
    importExists: "Already in catalog",
    importAdded: "{n} items added",
    importGo: "Add {n} items",
    errImportColumns: "File needs name and price columns",
    errImportBadFile: "Could not read this file",
    priceHistory: "Price history",
    priceHistoryEmpty: "No price changes yet",
    priceOld: "Old",
    priceNew: "New",
    supplierSendBack: "Send back",
    supplierReturns: "Sent back",
    tillDigital: "JazzCash / Easypaisa / bank (not in drawer)",
    productProfitTitle: "Profit per item",
    dateFrom: "From",
    dateTo: "To",
    ppProfit: "Profit",
    ppSales: "Sales",
    ppMargin: "Margin",
    ppCost: "Cost",
    ppEmpty: "No sales in these days",
    ppCostUnknown: "cost missing",
    returnUndone: "Return {id} undone",
    returnUndo: "Undo",
    returnReason: "Reason (optional)",
    returnUndoMsg: "Undo return {id} ({amount})? Stock and money go back as before.",
    notifExpiryTitle: "{n} batches near expiry",
    notifActionExpiry: "Open stock alerts",
    tillDigitalShort: "Digital (not in drawer)",
    ptType: "Type",
    ptNormal: "Normal",
    ptBulk: "Bulk",
    ptPacked: "Packed",
    ptKgPerPack: "kg per pack",
    ptSellLoose: "Sell bulk items loose by weight at the till",
    errBulkNeedsKg: "Bulk items are sold by kg. Set unit to kg first.",
    errBulkHasPackets: "Packed items are linked to this bulk item. Unlink them first.",
    errPackedNeedsBulk: "Pick the bulk item this is packed from",
    errPackedNeedsKg: "Enter kg per pack",
    errPackedIsPieces: "Packed items are counted in pieces, not kg",
    errInvalidProductType: "Pick a type",
    errPackedNotPurchasable: "Packed items are made by repacking, not bought. Buy the bulk item instead.",
    errRunAlreadyUndone: "Already undone",
    ptPackedBuyBulk: "{name} is packed from {bulk}. Buy {bulk}, then repack.",
    ptBulkNotLoose: "Loose item. Sell its packs.",
    ptRepackBtn: "Repack",
    rpLabelsTitle: "Labels · {name}",
    rpLabelsSkip: "Not now",
    rpLabelsBtn: "Labels",
    buBoughtBy: "Bought by",
    buBoughtLoose: "Bought loose",
    osTitle: "Opening stock",
    osSearch: "Search or scan barcode",
    osFilterAll: "All",
    osFilterTodo: "Not entered",
    osFilterDone: "Entered",
    osColProduct: "Product",
    osColUnit: "Unit",
    osColQty: "Qty on hand",
    osColCost: "Cost per unit (Rs)",
    osColValue: "Value",
    osColPrice: "Sell price",
    osPcs: "Pcs",
    osEntered: "Items entered",
    osTotalQty: "Total qty",
    osTotalValue: "Total value",
    osSaving: "Saving…",
    osSaved: "Saved",
    osSaveFailed: "Not saved",
    osDownloadExcel: "Download Excel",
    osFillExcel: "Fill from Excel",
    osPost: "Post opening stock",
    osExcelOnly: "Choose an Excel file (.xlsx)",
    osPreviewTitle: "Fill from Excel",
    osPreviewMsg: "{matched} matched · {unmatched} not found · {errors} with errors",
    osApply: "Fill {n} items",
    osCancel: "Cancel",
    osMatched: "Matched",
    osUnmatched: "Not found",
    osErrors: "Errors",
    osRow: "Row",
    osBarcode: "Barcode",
    osChangeNew: "New",
    osChangeUpdate: "Changed",
    osChangeSame: "No change",
    osConfirmTitle: "Post opening stock?",
    osConfirmMsg: "{n} items · {value}",
    osConfirmAdded: "Already sold or bought, so this adds to current stock:",
    osNoCost: "{n} items have no cost and count as Rs 0.",
    osConfirmBtn: "Post",
    osPosting: "Posting…",
    osNow: "Now",
    osAdd: "Add",
    osAfter: "After",
    osBatchTitle: "Opening stock #{n}",
    osItems: "{n} items",
    osExcel: "Excel",
    osPdf: "PDF",
    osUndo: "Undo",
    osUndone: "Undone",
    osAddMore: "Add more opening stock",
    osContinue: "Continue draft ({n})",
    osColEnteredAs: "Entered as",
    osColBefore: "Before",
    osAdded: "Added",
    osUndoTitle: "Undo opening stock #{n}?",
    osUndoMsg: "Stock and cost go back to before. The entries return to the draft.",
    osBlockSold: "Items sold since",
    osBlockBought: "Items bought since",
    osBlockReturned: "Items returned since",
    osBlockRepacked: "Items repacked since",
    osBlockChanged: "Stock changed since",
    osBlockNotLast: "Only the last batch can be undone",
    osErrSameName: "Two items have this name. Use the barcode.",
    osErrDup: "Same item as row {n}",
    osErrBoth: "Fill Qty or Cartons, not both",
    osErrQty: "Qty not valid",
    osErrCost: "Cost not valid",
    osErrUnits: "Pcs per carton missing",
    osErrFile: "Could not read this Excel file",
    osErrNoCols: "Product or Qty column missing",
    osErrNothing: "Nothing to post",
    osFilled: "{n} items filled from Excel",
    osPostedFlash: "Opening stock #{n} posted",
    osUndoneFlash: "Opening stock #{n} undone",
    osNotFound: "No item with barcode {code}",
    osNoRows: "No items",
    osTotal: "Total",
    osPosted: "Posted",
    osCostWarn: "Cost is at or above sell price",
    osAddsTo: "Now {qty} · this adds to it",
    osBy: "by {name}",
    rsTitle: "Reset data",
    rsKeeps: "Keeps products, users and shop settings. Deletes everything else.",
    rsButton: "Reset data…",
    rsModalTitle: "Reset all data?",
    rsModalMsg: "Sales, purchases, stock, customers, suppliers, expenses and staff payments will be deleted. A backup copy is saved first.",
    rsTypeLabel: "Type RESET to confirm",
    rsConfirm: "Reset data",
    rsBusy: "Resetting…",
    rsDone: "Data reset. Backup: {file}",
    rsFailed: "Reset stopped: {reason}. Nothing was deleted.",
    bcMore: "More barcodes",
    bcMoreHint: "Maker codes or old stickers. Scanning any of them finds this item. Labels print the main barcode.",
    bcAdd: "Add",
    bcRemove: "Remove barcode {code}",
    bcAlready: "Already on this item",
    bcTaken: "Barcode already used by another item",
    buPackedFrom: "Packed from",
    buInvalidMeasure: "Unit not allowed for this item",
    buCarton: "Carton",
    buCrate: "Crate",
    buPiece: "Piece",
    errInvalidBuyUnit: "Choose carton, crate or piece",
    errBulkBuysByKg: "Bulk items are bought by kg",
    errPackUnitsRequired: "Enter units in each carton / crate",
    plAddProduct: 'Add product',
    plAmount: 'Amount',
    plAriaPiecesEach: 'Pieces in each',
    plChargeName: 'Charge name',
    plCost: 'Cost',
    plCostRs: 'Cost (Rs)',
    plDelivery: 'Delivery',
    plDeliveryExtraChargesRs: 'Delivery / extra charges (Rs)',
    plDiscount: 'Discount',
    plEach: 'Each',
    plExtraCharges: 'Extra charges',
    plOrdered: 'Ordered',
    plPaid: 'Paid',
    plPaidSeparately: 'Paid separately',
    plProduct: 'Product',
    plQty: 'Qty',
    plRemaining: 'Remaining',
    plRemove: 'Remove',
    plRemoveCharge: 'Remove charge',
    plSalePrice: 'Sale price',
    plSubtotal: 'Subtotal',
    plTotalRs: 'Total (Rs)',
    poAriaPiecesPer: 'Pieces per {pkg} {name}',
    poAriaPriceEach: 'Price each {name}',
    poAriaPricePer: 'Price per {pkg} {name}',
    poAriaQty: 'Qty {name}',
    poAriaTotal: 'Total {name}',
    poBack: 'Back',
    poBelowCost: 'Below cost',
    poBills: 'Bills',
    poCancelConfirm: 'Cancel {po}?',
    poCancelOrder: 'Cancel order',
    poChooseSupplierFor: 'Choose a supplier for {name}',
    poCreateOrders: 'Create orders',
    poDate: 'Date',
    poDue: 'Due',
    poEdit: 'Edit',
    poErrAddProduct: 'Add at least one product',
    poErrBulkByKg: 'Bulk items are bought by kg',
    poErrCheckAmounts: 'Check the amounts',
    poErrCheckQty: 'Check the quantities',
    poErrCheckSalePrice: 'Check the sale price',
    poErrChooseSupplier: 'Choose a supplier',
    poErrDiscountHigh: 'Discount is more than the total',
    poErrGeneric: 'Something went wrong',
    poErrOrderLocked: 'This order can no longer be changed',
    poErrPackUnits: 'Enter units in each carton / crate',
    poErrPaidHigh: 'Paid is more than the total',
    poErrProductNotFound: 'Product not found',
    poExpected: 'Expected',
    poFromLowStock: 'From low stock',
    poHeadLanded: 'Landed cost',
    poHeadPcsPack: 'Pcs / pack',
    poHeadPriceRs: 'Price (Rs)',
    poInStock: 'In stock',
    poItems: 'Items',
    poLeaveUnsaved: 'This purchase has unsaved lines. Leave and lose them?',
    poLeaveTitle: 'Leave this purchase?',
    poLeaveYes: 'Leave',
    poLeaveStay: 'Stay',
    poLoading: 'Loading…',
    poMrp: 'MRP',
    poNewOrder: 'New order',
    poNo: 'No.',
    poNoOrders: 'No orders',
    poNoPhone: 'No phone',
    poNoSupplierYet: 'No supplier yet',
    poNothingIsLow: 'Nothing is low',
    poOrderQty: 'Order qty',
    poOrdered: 'Ordered',
    poPhone: 'Phone',
    poPick: 'Pick',
    poProduct: 'Product',
    poReceive: 'Receive',
    poReceived: 'Received',
    poRef: 'Ref',
    poReorderAt: 'Reorder at',
    poSave: 'Save',
    poSaveCloseOrder: 'Save & close order',
    poSaveDraft: 'Save draft',
    poSaveSend: 'Save & send',
    poSendAgain: 'Send again',
    poSendWhatsapp: 'Send on WhatsApp',
    poStAll: 'All',
    poStCancelled: 'Cancelled',
    poStDraft: 'Draft',
    poStOpen: 'Open',
    poStPartial: 'Partly received',
    poStReceived: 'Received',
    poStSent: 'Sent',
    poStatus: 'Status',
    poSubtotalExpected: 'Expected',
    poSuffixEach: 'each',
    poSuffixPcs: 'pcs',
    poSupplier: 'Supplier',
    poTabBills: 'Bills',
    poTabNewBill: 'New bill',
    poTabOrders: 'Orders',
    poTabsAria: 'Purchases',
    poTitleEdit: 'Edit {po}',
    poTitleList: 'Purchase orders',
    poTitleReceive: 'Receive {po}',
    poWhatsappMessage: 'WhatsApp message',
    ppApply: 'Apply',
    ppApplyAll: 'Apply all',
    ppApplyN: 'Apply {n}',
    ppAriaApply: 'Apply {name}',
    ppAriaNewPrice: 'New price {name}',
    ppCost2: 'Cost',
    ppLoss: 'Loss',
    ppMargin2: 'Margin',
    ppMarkup: 'Markup',
    ppMax: 'Max',
    ppNewPrice: 'New price',
    ppNotSaved: 'Not saved',
    ppNow: 'Now',
    ppPriceQ: 'Price?',
    ppProduct: 'Product',
    ppSalePrices: 'Sale prices',
    ppSkip: 'Skip',
    psAdd: 'Add',
    psCancel: 'Cancel',
    psChooseSupplier: 'Choose supplier',
    psErrAdd: 'Could not add supplier',
    psErrName: 'Enter a name',
    psName: 'Name',
    psNewSupplierAltN: 'New supplier (Alt+N)',
    psNoSupplier: 'No supplier',
    psPhone: 'Phone',
    psSupplier: 'Supplier',
    rpActions: 'Actions',
    rpBulkItem: 'Bulk item',
    rpBulkStock: 'Bulk stock',
    rpCost: 'Cost',
    rpCostEach: 'Cost each',
    rpCostPerUnit: 'Cost / {unit}',
    rpCsvBulk: 'Bulk item',
    rpCsvCost: 'Cost (Rs)',
    rpCsvDate: 'Date',
    rpCsvMade: 'Made',
    rpCsvNo: 'No.',
    rpCsvNote: 'Note',
    rpCsvPacking: 'Packing (Rs)',
    rpCsvUndone: 'Undone',
    rpCsvUsed: 'Used',
    rpCsvWastage: 'Wastage',
    rpCsvYes: 'Yes',
    rpDate: 'Date',
    rpErrBulkCost: 'Enter cost per unit of the bulk item',
    rpErrLines: 'Enter packets',
    rpErrNotEnough: 'Not enough in stock',
    rpErrQty: 'Check the numbers',
    rpErrSameDay: 'Only same-day repacks can be undone',
    rpErrSave: 'Could not save',
    rpErrSold: 'Packets already sold',
    rpErrUndo: 'Could not undo',
    rpErrUndone: 'Already undone',
    rpErrUsedLow: 'Used is less than needed',
    rpErrWastage: 'Check wastage',
    rpExcel: 'Excel',
    rpHistory: 'History',
    rpInStock: 'In stock',
    rpLeft: 'Left',
    rpLoading: 'Loading…',
    rpMade: 'Made',
    rpNewRepack: 'New repack',
    rpNoBulkItems: 'No bulk items',
    rpNoPackedSizes: 'No packed sizes',
    rpNoRepacks: 'No repacks',
    rpNote: 'Note',
    rpOnlyInStock: 'Only {qty} in stock',
    rpPacket: 'Packet',
    rpPackets: 'Packets',
    rpPackingPackRs: 'Packing / pack (Rs)',
    rpRepack: 'Repack',
    rpTotalCost: 'Total cost',
    rpUndo: 'Undo',
    rpUndoConfirm: 'Undo this repack?',
    rpUndone: 'Undone',
    rpUsed: 'Used',
    rpWastage: 'Wastage',
    rpWastageUnit: 'Wastage ({unit})',
  },
};

export function translate(locale: Locale, key: MessageKey): string {
  void locale;
  return dictionary.en[key] ?? key;
}
