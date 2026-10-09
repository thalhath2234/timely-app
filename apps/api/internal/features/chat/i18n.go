package chat

import (
	"strings"
	"unicode"
)

// Texts Timely writes into a conversation itself (notices, archive titles,
// push bodies), in the conversation's language. The model writes everything
// else, so it already answers in the person's language.
const (
	txtDone                 = "done"
	txtStopped              = "stopped"
	txtDiscarded            = "discarded"
	txtDataChanged          = "dataChanged"
	txtContinuing           = "continuing"
	txtReceiptConfirmed     = "receiptConfirmed"
	txtImageReviewDiscarded = "imageReviewDiscarded"
	txtReceiptReview        = "receiptReview"
	txtImageQuestion        = "imageQuestion"
	txtReceiptRevised       = "receiptRevised"
	txtPreviousChanges      = "previousChanges"
	txtDiscardedChanges     = "discardedChanges"
	txtPushReply            = "pushReply"
	txtPushReview           = "pushReview"
	txtPushComplete         = "pushComplete"
	txtPushAttention        = "pushAttention"
	txtPushContinuing       = "pushContinuing"
	txtPushImage            = "pushImage"
	txtPushDuplicate        = "pushDuplicate"
	txtPushReceipt          = "pushReceipt"
	txtPushReceiptAgain     = "pushReceiptAgain"
	txtPushReceiptRevised   = "pushReceiptRevised"
	txtNoteNotAsked         = "noteNotAsked"
	txtNoteMissing          = "noteMissing"
	txtPushChoose           = "pushChoose"
	txtReceiptNotCorrection = "receiptNotCorrection"
	txtHintCategory         = "hintCategory"
	txtHintCategoryFit      = "hintCategoryFit"
	txtHintRefund           = "hintRefund"
	txtHintSamePurchase     = "hintSamePurchase"
	txtHintTaxIncluded      = "hintTaxIncluded"
	txtHintDiscountIncluded = "hintDiscountIncluded"
	txtNoteSheetChange      = "noteSheetChange"
)

var texts = map[string]map[string]string{
	"en": {
		txtDone:                 "Done — your changes are saved.",
		txtStopped:              "Stopped. Completed changes are kept.",
		txtDiscarded:            "Proposal discarded. Nothing was changed.",
		txtDataChanged:          "The data changed before the remaining changes were applied. Preparing a refreshed proposal; completed changes are kept.",
		txtContinuing:           "This part is saved. Continuing with the rest of your request.",
		txtReceiptConfirmed:     "Receipt details confirmed. Temporary images removed.",
		txtImageReviewDiscarded: "Image review discarded. Temporary images were removed; extracted draft data is kept.",
		txtReceiptReview:        "Review the receipt below; correct highlighted fields and choose where to save it. If no individual items are available, the merchant and total will be saved as one summary item.",
		txtImageQuestion:        "What would you like to do with this image?",
		txtReceiptRevised:       "I've revised the receipt draft. Review the fields below before preparing the sheet changes.",
		txtPreviousChanges:      "Previous changes",
		txtDiscardedChanges:     "Discarded changes",
		txtPushReply:            "Your chat has a new reply.",
		txtPushReview:           "Review your proposed changes.",
		txtPushComplete:         "Your changes are complete.",
		txtPushAttention:        "Chat needs attention. Open it to review or retry.",
		txtPushContinuing:       "Part of your request is saved; working on the rest.",
		txtPushImage:            "Your image is ready to review.",
		txtPushDuplicate:        "Review a possible duplicate receipt.",
		txtPushReceipt:          "Your receipt is ready to apply.",
		txtPushReceiptAgain:     "Your receipt needs another review.",
		txtPushReceiptRevised:   "Your revised receipt is ready to review.",
		txtNoteNotAsked:         "You may not have asked for this change:",
		txtNoteMissing:          "Something you asked for may be missing from these changes.",
		txtPushChoose:           "You already have a chat about this. Choose where to continue.",
		txtReceiptNotCorrection: "That doesn't look like a change to the receipt, so the draft is unchanged. Edit the fields below, or say what to change, for example “the total is 12.40”.",
		txtHintCategory:         "Category set to “%s”, one you already use. Change it if it's wrong.",
		txtHintCategoryFit:      "“%s” may not be the right category for this receipt.",
		txtHintRefund:           "This looks like a refund or return. Check that the amounts have the right sign.",
		txtHintSamePurchase:     "This may be the same purchase as %s on %s, already in “%s”.",
		txtHintTaxIncluded:      "The amounts add up if tax is already included in the prices. Tick “Tax included” if so.",
		txtHintDiscountIncluded: "The amounts add up if the discount is already taken off the item prices. Tick “Discount included” if so.",
		txtNoteSheetChange:      "This sheet change may not match what you asked:",
	},
	"ja": {
		txtDone:                 "完了しました。変更は保存されています。",
		txtStopped:              "停止しました。完了した変更はそのまま残ります。",
		txtDiscarded:            "提案を破棄しました。何も変更されていません。",
		txtDataChanged:          "残りの変更を適用する前にデータが変更されました。提案を更新しています。完了した変更はそのまま残ります。",
		txtContinuing:           "この部分は保存しました。残りの依頼を続けます。",
		txtReceiptConfirmed:     "レシートの内容を確定しました。一時画像は削除しました。",
		txtImageReviewDiscarded: "画像の確認を破棄しました。一時画像は削除し、抽出した下書きデータは残しています。",
		txtReceiptReview:        "下のレシートを確認してください。強調された項目を修正し、保存先を選んでください。品目がない場合は、店名と合計を1件のまとめとして保存します。",
		txtImageQuestion:        "この画像をどうしますか？",
		txtReceiptRevised:       "レシートの下書きを修正しました。シートの変更を準備する前に、下の項目を確認してください。",
		txtPreviousChanges:      "以前の変更",
		txtDiscardedChanges:     "破棄した変更",
		txtPushReply:            "チャットに新しい返信があります。",
		txtPushReview:           "提案された変更を確認してください。",
		txtPushComplete:         "変更が完了しました。",
		txtPushAttention:        "チャットで対応が必要です。開いて確認するか再試行してください。",
		txtPushContinuing:       "依頼の一部を保存しました。残りを進めています。",
		txtPushImage:            "画像の確認の準備ができました。",
		txtPushDuplicate:        "重複している可能性のあるレシートを確認してください。",
		txtPushReceipt:          "レシートを適用する準備ができました。",
		txtPushReceiptAgain:     "レシートをもう一度確認してください。",
		txtPushReceiptRevised:   "修正したレシートの確認の準備ができました。",
		txtNoteNotAsked:         "この変更は依頼されていない可能性があります:",
		txtNoteMissing:          "依頼した内容の一部が、これらの変更に含まれていない可能性があります。",
		txtPushChoose:           "この件についてのチャットがすでにあります。どこで続けるか選んでください。",
		txtReceiptNotCorrection: "レシートの変更ではないようなので、下書きはそのままです。下の項目を編集するか、「合計は12.40」のように変更内容を伝えてください。",
		txtHintCategory:         "カテゴリをすでに使っている「%s」にしました。違う場合は変更してください。",
		txtHintCategoryFit:      "「%s」はこのレシートに合うカテゴリではないかもしれません。",
		txtHintRefund:           "返金または返品のようです。金額の符号を確認してください。",
		txtHintSamePurchase:     "%s（%s）の購入と同じかもしれません。すでに「%s」にあります。",
		txtHintTaxIncluded:      "税が価格に含まれていれば金額が合います。その場合は「税込み」にチェックしてください。",
		txtHintDiscountIncluded: "割引が品目の価格から引かれていれば金額が合います。その場合は「割引込み」にチェックしてください。",
		txtNoteSheetChange:      "このシートの変更は依頼と合っていない可能性があります:",
	},
	"zh": {
		txtDone:                 "完成——您的更改已保存。",
		txtStopped:              "已停止。已完成的更改会保留。",
		txtDiscarded:            "已放弃提案。没有做任何更改。",
		txtDataChanged:          "在应用剩余更改之前数据已发生变化。正在准备更新后的提案；已完成的更改会保留。",
		txtContinuing:           "这一部分已保存。正在继续处理您请求的其余部分。",
		txtReceiptConfirmed:     "收据信息已确认。临时图片已删除。",
		txtImageReviewDiscarded: "已放弃图片审核。临时图片已删除；提取的草稿数据会保留。",
		txtReceiptReview:        "请查看下方收据；更正高亮字段并选择保存位置。如果没有单项明细，将把商家和总额保存为一条汇总记录。",
		txtImageQuestion:        "您想如何处理这张图片？",
		txtReceiptRevised:       "我已修改收据草稿。在准备表格更改之前，请查看下方字段。",
		txtPreviousChanges:      "之前的更改",
		txtDiscardedChanges:     "已放弃的更改",
		txtPushReply:            "您的聊天有新回复。",
		txtPushReview:           "请查看提议的更改。",
		txtPushComplete:         "您的更改已完成。",
		txtPushAttention:        "聊天需要处理。请打开查看或重试。",
		txtPushContinuing:       "请求的一部分已保存，正在处理其余部分。",
		txtPushImage:            "您的图片已可以查看。",
		txtPushDuplicate:        "请查看可能重复的收据。",
		txtPushReceipt:          "您的收据已可以应用。",
		txtPushReceiptAgain:     "您的收据需要再次查看。",
		txtPushReceiptRevised:   "修改后的收据已可以查看。",
		txtNoteNotAsked:         "您可能没有要求这项更改:",
		txtNoteMissing:          "您要求的部分内容可能不在这些更改中。",
		txtPushChoose:           "您已经有一个关于此事的聊天。请选择在哪里继续。",
		txtReceiptNotCorrection: "这看起来不是对收据的修改，因此草稿保持不变。请编辑下方字段，或说明要改什么，例如“总额是 12.40”。",
		txtHintCategory:         "类别已设为您已在使用的“%s”。如有误请修改。",
		txtHintCategoryFit:      "“%s”可能不是这张收据的合适类别。",
		txtHintRefund:           "这看起来是退款或退货。请检查金额的正负号。",
		txtHintSamePurchase:     "这可能与 %s 在 %s 的消费相同，已在“%s”中。",
		txtHintTaxIncluded:      "如果税已包含在价格中，金额就能对上。如是，请勾选“含税”。",
		txtHintDiscountIncluded: "如果折扣已从商品价格中扣除，金额就能对上。如是，请勾选“已含折扣”。",
		txtNoteSheetChange:      "此表格更改可能与您的要求不符:",
	},
	"ko": {
		txtDone:                 "완료되었습니다. 변경 사항이 저장되었습니다.",
		txtStopped:              "중지했습니다. 완료된 변경 사항은 유지됩니다.",
		txtDiscarded:            "제안을 취소했습니다. 아무것도 변경되지 않았습니다.",
		txtDataChanged:          "남은 변경 사항을 적용하기 전에 데이터가 바뀌었습니다. 새 제안을 준비하고 있으며, 완료된 변경 사항은 유지됩니다.",
		txtContinuing:           "이 부분은 저장했습니다. 요청의 나머지를 계속 진행합니다.",
		txtReceiptConfirmed:     "영수증 정보를 확인했습니다. 임시 이미지는 삭제했습니다.",
		txtImageReviewDiscarded: "이미지 검토를 취소했습니다. 임시 이미지는 삭제했고 추출한 초안 데이터는 유지됩니다.",
		txtReceiptReview:        "아래 영수증을 검토하세요. 강조된 항목을 수정하고 저장할 위치를 선택하세요. 개별 항목이 없으면 가맹점과 합계를 요약 항목 하나로 저장합니다.",
		txtImageQuestion:        "이 이미지로 무엇을 할까요?",
		txtReceiptRevised:       "영수증 초안을 수정했습니다. 시트 변경을 준비하기 전에 아래 항목을 검토하세요.",
		txtPreviousChanges:      "이전 변경 사항",
		txtDiscardedChanges:     "취소한 변경 사항",
		txtPushReply:            "채팅에 새 답장이 있습니다.",
		txtPushReview:           "제안된 변경 사항을 검토하세요.",
		txtPushComplete:         "변경이 완료되었습니다.",
		txtPushAttention:        "채팅에 확인이 필요합니다. 열어서 검토하거나 다시 시도하세요.",
		txtPushContinuing:       "요청의 일부를 저장했고 나머지를 진행 중입니다.",
		txtPushImage:            "이미지를 검토할 준비가 되었습니다.",
		txtPushDuplicate:        "중복일 수 있는 영수증을 검토하세요.",
		txtPushReceipt:          "영수증을 적용할 준비가 되었습니다.",
		txtPushReceiptAgain:     "영수증을 다시 검토해야 합니다.",
		txtPushReceiptRevised:   "수정된 영수증을 검토할 준비가 되었습니다.",
		txtNoteNotAsked:         "요청하지 않은 변경일 수 있습니다:",
		txtNoteMissing:          "요청하신 내용 중 일부가 이 변경 사항에 빠져 있을 수 있습니다.",
		txtPushChoose:           "이 내용에 대한 채팅이 이미 있습니다. 어디에서 계속할지 선택하세요.",
		txtReceiptNotCorrection: "영수증 변경 요청이 아닌 것 같아 초안을 그대로 두었습니다. 아래 항목을 수정하거나 “합계는 12.40”처럼 바꿀 내용을 알려 주세요.",
		txtHintCategory:         "이미 사용 중인 “%s” 카테고리로 설정했습니다. 틀리면 바꿔 주세요.",
		txtHintCategoryFit:      "“%s”은(는) 이 영수증에 맞는 카테고리가 아닐 수 있습니다.",
		txtHintRefund:           "환불 또는 반품으로 보입니다. 금액의 부호를 확인하세요.",
		txtHintSamePurchase:     "%s의 %s 구매와 같은 건일 수 있으며, 이미 “%s”에 있습니다.",
		txtHintTaxIncluded:      "세금이 가격에 포함되어 있다면 금액이 맞습니다. 그렇다면 “세금 포함”을 선택하세요.",
		txtHintDiscountIncluded: "할인이 품목 가격에서 이미 빠졌다면 금액이 맞습니다. 그렇다면 “할인 포함”을 선택하세요.",
		txtNoteSheetChange:      "이 시트 변경이 요청과 다를 수 있습니다:",
	},
	"es": {
		txtDone:                 "Listo: tus cambios están guardados.",
		txtStopped:              "Detenido. Los cambios completados se conservan.",
		txtDiscarded:            "Propuesta descartada. No se cambió nada.",
		txtDataChanged:          "Los datos cambiaron antes de aplicar los cambios restantes. Preparando una propuesta actualizada; los cambios completados se conservan.",
		txtContinuing:           "Esta parte está guardada. Sigo con el resto de tu solicitud.",
		txtReceiptConfirmed:     "Datos del recibo confirmados. Se eliminaron las imágenes temporales.",
		txtImageReviewDiscarded: "Revisión de imagen descartada. Se eliminaron las imágenes temporales; se conservan los datos extraídos.",
		txtReceiptReview:        "Revisa el recibo; corrige los campos resaltados y elige dónde guardarlo. Si no hay artículos individuales, se guardarán el comercio y el total como un solo artículo resumen.",
		txtImageQuestion:        "¿Qué quieres hacer con esta imagen?",
		txtReceiptRevised:       "He revisado el borrador del recibo. Revisa los campos antes de preparar los cambios en la hoja.",
		txtPreviousChanges:      "Cambios anteriores",
		txtDiscardedChanges:     "Cambios descartados",
		txtPushReply:            "Tu chat tiene una respuesta nueva.",
		txtPushReview:           "Revisa los cambios propuestos.",
		txtPushComplete:         "Tus cambios están completos.",
		txtPushAttention:        "El chat necesita atención. Ábrelo para revisar o reintentar.",
		txtPushContinuing:       "Parte de tu solicitud está guardada; sigo con el resto.",
		txtPushImage:            "Tu imagen está lista para revisar.",
		txtPushDuplicate:        "Revisa un posible recibo duplicado.",
		txtPushReceipt:          "Tu recibo está listo para aplicar.",
		txtPushReceiptAgain:     "Tu recibo necesita otra revisión.",
		txtPushReceiptRevised:   "Tu recibo revisado está listo para revisar.",
		txtNoteNotAsked:         "Puede que no hayas pedido este cambio:",
		txtNoteMissing:          "Puede que falte algo de lo que pediste en estos cambios.",
		txtPushChoose:           "Ya tienes un chat sobre esto. Elige dónde continuar.",
		txtReceiptNotCorrection: "Eso no parece un cambio en el recibo, así que el borrador sigue igual. Edita los campos de abajo o di qué cambiar, por ejemplo “el total es 12.40”.",
		txtHintCategory:         "Categoría establecida en “%s”, una que ya usas. Cámbiala si no es correcta.",
		txtHintCategoryFit:      "“%s” quizá no sea la categoría adecuada para este recibo.",
		txtHintRefund:           "Parece un reembolso o una devolución. Comprueba que los importes tengan el signo correcto.",
		txtHintSamePurchase:     "Puede ser la misma compra que %s del %s, ya registrada en “%s”.",
		txtHintTaxIncluded:      "Los importes cuadran si el impuesto ya está incluido en los precios. Si es así, marca “Impuesto incluido”.",
		txtHintDiscountIncluded: "Los importes cuadran si el descuento ya está restado de los precios. Si es así, marca “Descuento incluido”.",
		txtNoteSheetChange:      "Este cambio en la hoja puede no coincidir con lo que pediste:",
	},
	"fr": {
		txtDone:                 "Terminé — vos modifications sont enregistrées.",
		txtStopped:              "Arrêté. Les modifications terminées sont conservées.",
		txtDiscarded:            "Proposition abandonnée. Rien n'a été modifié.",
		txtDataChanged:          "Les données ont changé avant l'application des modifications restantes. Préparation d'une proposition actualisée ; les modifications terminées sont conservées.",
		txtContinuing:           "Cette partie est enregistrée. Je continue avec le reste de votre demande.",
		txtReceiptConfirmed:     "Détails du reçu confirmés. Images temporaires supprimées.",
		txtImageReviewDiscarded: "Vérification de l'image abandonnée. Les images temporaires ont été supprimées ; les données extraites sont conservées.",
		txtReceiptReview:        "Vérifiez le reçu ci-dessous ; corrigez les champs surlignés et choisissez où l'enregistrer. Sans articles détaillés, le commerçant et le total seront enregistrés en un seul article récapitulatif.",
		txtImageQuestion:        "Que voulez-vous faire de cette image ?",
		txtReceiptRevised:       "J'ai révisé le brouillon du reçu. Vérifiez les champs ci-dessous avant de préparer les modifications de la feuille.",
		txtPreviousChanges:      "Modifications précédentes",
		txtDiscardedChanges:     "Modifications abandonnées",
		txtPushReply:            "Votre conversation a une nouvelle réponse.",
		txtPushReview:           "Vérifiez les modifications proposées.",
		txtPushComplete:         "Vos modifications sont terminées.",
		txtPushAttention:        "La conversation demande votre attention. Ouvrez-la pour vérifier ou réessayer.",
		txtPushContinuing:       "Une partie de votre demande est enregistrée ; je continue avec le reste.",
		txtPushImage:            "Votre image est prête à être vérifiée.",
		txtPushDuplicate:        "Vérifiez un reçu possiblement en double.",
		txtPushReceipt:          "Votre reçu est prêt à être appliqué.",
		txtPushReceiptAgain:     "Votre reçu doit être vérifié à nouveau.",
		txtPushReceiptRevised:   "Votre reçu révisé est prêt à être vérifié.",
		txtNoteNotAsked:         "Vous n'avez peut-être pas demandé cette modification :",
		txtNoteMissing:          "Une partie de votre demande manque peut-être dans ces modifications.",
		txtPushChoose:           "Vous avez déjà une conversation à ce sujet. Choisissez où continuer.",
		txtReceiptNotCorrection: "Cela ne ressemble pas à une modification du reçu, le brouillon est donc inchangé. Modifiez les champs ci-dessous ou dites quoi changer, par exemple « le total est 12.40 ».",
		txtHintCategory:         "Catégorie définie sur « %s », que vous utilisez déjà. Changez-la si elle est fausse.",
		txtHintCategoryFit:      "« %s » n'est peut-être pas la bonne catégorie pour ce reçu.",
		txtHintRefund:           "Cela ressemble à un remboursement ou un retour. Vérifiez le signe des montants.",
		txtHintSamePurchase:     "Il s'agit peut-être du même achat que %s le %s, déjà dans « %s ».",
		txtHintTaxIncluded:      "Les montants concordent si la taxe est déjà incluse dans les prix. Cochez « Taxe incluse » le cas échéant.",
		txtHintDiscountIncluded: "Les montants concordent si la remise est déjà déduite des prix. Cochez « Remise incluse » le cas échéant.",
		txtNoteSheetChange:      "Cette modification de la feuille ne correspond peut-être pas à votre demande :",
	},
	"de": {
		txtDone:                 "Fertig – deine Änderungen sind gespeichert.",
		txtStopped:              "Gestoppt. Abgeschlossene Änderungen bleiben erhalten.",
		txtDiscarded:            "Vorschlag verworfen. Es wurde nichts geändert.",
		txtDataChanged:          "Die Daten haben sich geändert, bevor die restlichen Änderungen übernommen wurden. Ein aktualisierter Vorschlag wird vorbereitet; abgeschlossene Änderungen bleiben erhalten.",
		txtContinuing:           "Dieser Teil ist gespeichert. Ich mache mit dem Rest deiner Anfrage weiter.",
		txtReceiptConfirmed:     "Belegdaten bestätigt. Temporäre Bilder wurden entfernt.",
		txtImageReviewDiscarded: "Bildprüfung verworfen. Temporäre Bilder wurden entfernt; die extrahierten Entwurfsdaten bleiben erhalten.",
		txtReceiptReview:        "Prüfe den Beleg unten, korrigiere markierte Felder und wähle, wo er gespeichert wird. Ohne einzelne Positionen werden Händler und Summe als eine Sammelposition gespeichert.",
		txtImageQuestion:        "Was möchtest du mit diesem Bild machen?",
		txtReceiptRevised:       "Ich habe den Belegentwurf überarbeitet. Prüfe die Felder unten, bevor die Tabellenänderungen vorbereitet werden.",
		txtPreviousChanges:      "Frühere Änderungen",
		txtDiscardedChanges:     "Verworfene Änderungen",
		txtPushReply:            "Dein Chat hat eine neue Antwort.",
		txtPushReview:           "Prüfe die vorgeschlagenen Änderungen.",
		txtPushComplete:         "Deine Änderungen sind abgeschlossen.",
		txtPushAttention:        "Der Chat braucht deine Aufmerksamkeit. Öffne ihn, um zu prüfen oder es erneut zu versuchen.",
		txtPushContinuing:       "Ein Teil deiner Anfrage ist gespeichert; der Rest wird bearbeitet.",
		txtPushImage:            "Dein Bild kann geprüft werden.",
		txtPushDuplicate:        "Prüfe einen möglicherweise doppelten Beleg.",
		txtPushReceipt:          "Dein Beleg kann übernommen werden.",
		txtPushReceiptAgain:     "Dein Beleg muss erneut geprüft werden.",
		txtPushReceiptRevised:   "Dein überarbeiteter Beleg kann geprüft werden.",
		txtNoteNotAsked:         "Diese Änderung hast du vielleicht nicht angefordert:",
		txtNoteMissing:          "Etwas, worum du gebeten hast, fehlt möglicherweise in diesen Änderungen.",
		txtPushChoose:           "Du hast schon einen Chat dazu. Wähle, wo es weitergehen soll.",
		txtReceiptNotCorrection: "Das sieht nicht nach einer Änderung am Beleg aus, daher bleibt der Entwurf unverändert. Bearbeite die Felder unten oder sag, was sich ändern soll, z. B. „die Summe ist 12.40“.",
		txtHintCategory:         "Kategorie auf „%s“ gesetzt, die du schon nutzt. Ändere sie, falls sie nicht stimmt.",
		txtHintCategoryFit:      "„%s“ ist vielleicht nicht die richtige Kategorie für diesen Beleg.",
		txtHintRefund:           "Das sieht nach einer Erstattung oder Rückgabe aus. Prüfe das Vorzeichen der Beträge.",
		txtHintSamePurchase:     "Das könnte derselbe Einkauf sein wie %s am %s, bereits in „%s“.",
		txtHintTaxIncluded:      "Die Beträge gehen auf, wenn die Steuer schon in den Preisen enthalten ist. Setze dann „Steuer enthalten“.",
		txtHintDiscountIncluded: "Die Beträge gehen auf, wenn der Rabatt schon von den Preisen abgezogen ist. Setze dann „Rabatt enthalten“.",
		txtNoteSheetChange:      "Diese Tabellenänderung passt vielleicht nicht zu deiner Anfrage:",
	},
	"pt": {
		txtDone:                 "Pronto — suas alterações foram salvas.",
		txtStopped:              "Parado. As alterações concluídas foram mantidas.",
		txtDiscarded:            "Proposta descartada. Nada foi alterado.",
		txtDataChanged:          "Os dados mudaram antes de aplicar as alterações restantes. Preparando uma proposta atualizada; as alterações concluídas foram mantidas.",
		txtContinuing:           "Esta parte está salva. Continuando com o restante do seu pedido.",
		txtReceiptConfirmed:     "Dados do recibo confirmados. Imagens temporárias removidas.",
		txtImageReviewDiscarded: "Revisão da imagem descartada. As imagens temporárias foram removidas; os dados extraídos foram mantidos.",
		txtReceiptReview:        "Revise o recibo abaixo; corrija os campos destacados e escolha onde salvá-lo. Se não houver itens individuais, o estabelecimento e o total serão salvos como um único item de resumo.",
		txtImageQuestion:        "O que você quer fazer com esta imagem?",
		txtReceiptRevised:       "Revisei o rascunho do recibo. Revise os campos abaixo antes de preparar as alterações na planilha.",
		txtPreviousChanges:      "Alterações anteriores",
		txtDiscardedChanges:     "Alterações descartadas",
		txtPushReply:            "Seu chat tem uma nova resposta.",
		txtPushReview:           "Revise as alterações propostas.",
		txtPushComplete:         "Suas alterações foram concluídas.",
		txtPushAttention:        "O chat precisa de atenção. Abra-o para revisar ou tentar novamente.",
		txtPushContinuing:       "Parte do seu pedido foi salva; continuando com o restante.",
		txtPushImage:            "Sua imagem está pronta para revisão.",
		txtPushDuplicate:        "Revise um possível recibo duplicado.",
		txtPushReceipt:          "Seu recibo está pronto para ser aplicado.",
		txtPushReceiptAgain:     "Seu recibo precisa de outra revisão.",
		txtPushReceiptRevised:   "Seu recibo revisado está pronto para revisão.",
		txtNoteNotAsked:         "Talvez você não tenha pedido esta alteração:",
		txtNoteMissing:          "Algo que você pediu pode estar faltando nestas alterações.",
		txtPushChoose:           "Você já tem um chat sobre isso. Escolha onde continuar.",
		txtReceiptNotCorrection: "Isso não parece uma alteração no recibo, então o rascunho ficou igual. Edite os campos abaixo ou diga o que mudar, por exemplo “o total é 12.40”.",
		txtHintCategory:         "Categoria definida como “%s”, que você já usa. Altere se estiver errada.",
		txtHintCategoryFit:      "“%s” talvez não seja a categoria certa para este recibo.",
		txtHintRefund:           "Parece um reembolso ou devolução. Verifique se os valores têm o sinal certo.",
		txtHintSamePurchase:     "Pode ser a mesma compra que %s em %s, já registrada em “%s”.",
		txtHintTaxIncluded:      "Os valores batem se o imposto já estiver incluído nos preços. Se for o caso, marque “Imposto incluído”.",
		txtHintDiscountIncluded: "Os valores batem se o desconto já tiver sido tirado dos preços. Se for o caso, marque “Desconto incluído”.",
		txtNoteSheetChange:      "Esta alteração na planilha pode não corresponder ao que você pediu:",
	},
	"it": {
		txtDone:                 "Fatto: le modifiche sono salvate.",
		txtStopped:              "Interrotto. Le modifiche completate restano salvate.",
		txtDiscarded:            "Proposta scartata. Non è stato modificato nulla.",
		txtDataChanged:          "I dati sono cambiati prima di applicare le modifiche rimanenti. Sto preparando una proposta aggiornata; le modifiche completate restano salvate.",
		txtContinuing:           "Questa parte è salvata. Continuo con il resto della richiesta.",
		txtReceiptConfirmed:     "Dati dello scontrino confermati. Immagini temporanee rimosse.",
		txtImageReviewDiscarded: "Revisione dell'immagine scartata. Le immagini temporanee sono state rimosse; i dati estratti restano salvati.",
		txtReceiptReview:        "Controlla lo scontrino qui sotto; correggi i campi evidenziati e scegli dove salvarlo. Se non ci sono singole voci, esercente e totale verranno salvati come un'unica voce di riepilogo.",
		txtImageQuestion:        "Cosa vuoi fare con questa immagine?",
		txtReceiptRevised:       "Ho rivisto la bozza dello scontrino. Controlla i campi qui sotto prima di preparare le modifiche al foglio.",
		txtPreviousChanges:      "Modifiche precedenti",
		txtDiscardedChanges:     "Modifiche scartate",
		txtPushReply:            "La tua chat ha una nuova risposta.",
		txtPushReview:           "Controlla le modifiche proposte.",
		txtPushComplete:         "Le modifiche sono complete.",
		txtPushAttention:        "La chat richiede attenzione. Aprila per controllare o riprovare.",
		txtPushContinuing:       "Parte della richiesta è salvata; continuo con il resto.",
		txtPushImage:            "La tua immagine è pronta per la revisione.",
		txtPushDuplicate:        "Controlla un possibile scontrino duplicato.",
		txtPushReceipt:          "Il tuo scontrino è pronto per essere applicato.",
		txtPushReceiptAgain:     "Il tuo scontrino va controllato di nuovo.",
		txtPushReceiptRevised:   "Lo scontrino rivisto è pronto per la revisione.",
		txtNoteNotAsked:         "Potresti non aver chiesto questa modifica:",
		txtNoteMissing:          "Qualcosa che hai chiesto potrebbe mancare in queste modifiche.",
		txtPushChoose:           "Hai già una chat su questo. Scegli dove continuare.",
		txtReceiptNotCorrection: "Non sembra una modifica allo scontrino, quindi la bozza resta invariata. Modifica i campi qui sotto o di' cosa cambiare, per esempio “il totale è 12.40”.",
		txtHintCategory:         "Categoria impostata su “%s”, che usi già. Cambiala se è sbagliata.",
		txtHintCategoryFit:      "“%s” potrebbe non essere la categoria giusta per questo scontrino.",
		txtHintRefund:           "Sembra un rimborso o un reso. Controlla il segno degli importi.",
		txtHintSamePurchase:     "Potrebbe essere lo stesso acquisto di %s del %s, già in “%s”.",
		txtHintTaxIncluded:      "Gli importi tornano se l'imposta è già inclusa nei prezzi. In tal caso seleziona “Imposta inclusa”.",
		txtHintDiscountIncluded: "Gli importi tornano se lo sconto è già tolto dai prezzi. In tal caso seleziona “Sconto incluso”.",
		txtNoteSheetChange:      "Questa modifica al foglio potrebbe non corrispondere alla tua richiesta:",
	},
	"ru": {
		txtDone:                 "Готово — изменения сохранены.",
		txtStopped:              "Остановлено. Выполненные изменения сохранены.",
		txtDiscarded:            "Предложение отклонено. Ничего не изменено.",
		txtDataChanged:          "Данные изменились до применения оставшихся изменений. Готовлю обновлённое предложение; выполненные изменения сохранены.",
		txtContinuing:           "Эта часть сохранена. Продолжаю с остальной частью запроса.",
		txtReceiptConfirmed:     "Данные чека подтверждены. Временные изображения удалены.",
		txtImageReviewDiscarded: "Проверка изображения отменена. Временные изображения удалены; извлечённые данные сохранены.",
		txtReceiptReview:        "Проверьте чек ниже: исправьте выделенные поля и выберите, куда его сохранить. Если отдельных позиций нет, продавец и итог будут сохранены одной сводной позицией.",
		txtImageQuestion:        "Что сделать с этим изображением?",
		txtReceiptRevised:       "Я обновил черновик чека. Проверьте поля ниже, прежде чем готовить изменения в таблице.",
		txtPreviousChanges:      "Предыдущие изменения",
		txtDiscardedChanges:     "Отклонённые изменения",
		txtPushReply:            "В чате новый ответ.",
		txtPushReview:           "Проверьте предложенные изменения.",
		txtPushComplete:         "Изменения выполнены.",
		txtPushAttention:        "Чат требует внимания. Откройте его, чтобы проверить или повторить.",
		txtPushContinuing:       "Часть запроса сохранена; работаю над остальным.",
		txtPushImage:            "Изображение готово к проверке.",
		txtPushDuplicate:        "Проверьте возможный дубликат чека.",
		txtPushReceipt:          "Чек готов к применению.",
		txtPushReceiptAgain:     "Чек нужно проверить ещё раз.",
		txtPushReceiptRevised:   "Обновлённый чек готов к проверке.",
		txtNoteNotAsked:         "Возможно, вы не просили об этом изменении:",
		txtNoteMissing:          "Возможно, в этих изменениях не хватает чего-то из того, что вы просили.",
		txtPushChoose:           "У вас уже есть чат об этом. Выберите, где продолжить.",
		txtReceiptNotCorrection: "Это не похоже на изменение чека, поэтому черновик не изменён. Отредактируйте поля ниже или напишите, что изменить, например «итого 12.40».",
		txtHintCategory:         "Категория установлена как «%s», которую вы уже используете. Измените, если она неверна.",
		txtHintCategoryFit:      "«%s», возможно, не подходит как категория для этого чека.",
		txtHintRefund:           "Похоже на возврат. Проверьте знак сумм.",
		txtHintSamePurchase:     "Возможно, это та же покупка, что и %s от %s, уже записанная в «%s».",
		txtHintTaxIncluded:      "Суммы сходятся, если налог уже включён в цены. Если так, отметьте «Налог включён».",
		txtHintDiscountIncluded: "Суммы сходятся, если скидка уже вычтена из цен. Если так, отметьте «Скидка включена».",
		txtNoteSheetChange:      "Это изменение таблицы может не соответствовать вашей просьбе:",
	},
	"ar": {
		txtDone:                 "تم — حُفظت تغييراتك.",
		txtStopped:              "تم الإيقاف. تبقى التغييرات المكتملة محفوظة.",
		txtDiscarded:            "تم تجاهل الاقتراح. لم يتغير شيء.",
		txtDataChanged:          "تغيّرت البيانات قبل تطبيق التغييرات المتبقية. يجري إعداد اقتراح محدّث؛ تبقى التغييرات المكتملة محفوظة.",
		txtContinuing:           "حُفظ هذا الجزء. أتابع بقية طلبك.",
		txtReceiptConfirmed:     "تم تأكيد تفاصيل الإيصال. حُذفت الصور المؤقتة.",
		txtImageReviewDiscarded: "تم تجاهل مراجعة الصورة. حُذفت الصور المؤقتة؛ وتبقى البيانات المستخرجة محفوظة.",
		txtReceiptReview:        "راجع الإيصال أدناه؛ صحّح الحقول المميزة واختر مكان حفظه. إذا لم تتوفر بنود منفصلة، فسيُحفظ اسم المتجر والإجمالي كبند ملخّص واحد.",
		txtImageQuestion:        "ماذا تريد أن تفعل بهذه الصورة؟",
		txtReceiptRevised:       "عدّلت مسودة الإيصال. راجع الحقول أدناه قبل إعداد تغييرات الجدول.",
		txtPreviousChanges:      "التغييرات السابقة",
		txtDiscardedChanges:     "التغييرات المتجاهَلة",
		txtPushReply:            "في محادثتك رد جديد.",
		txtPushReview:           "راجع التغييرات المقترحة.",
		txtPushComplete:         "اكتملت تغييراتك.",
		txtPushAttention:        "المحادثة تحتاج إلى انتباهك. افتحها للمراجعة أو إعادة المحاولة.",
		txtPushContinuing:       "حُفظ جزء من طلبك؛ أتابع البقية.",
		txtPushImage:            "صورتك جاهزة للمراجعة.",
		txtPushDuplicate:        "راجع إيصالًا قد يكون مكررًا.",
		txtPushReceipt:          "إيصالك جاهز للتطبيق.",
		txtPushReceiptAgain:     "يحتاج إيصالك إلى مراجعة أخرى.",
		txtPushReceiptRevised:   "إيصالك المعدّل جاهز للمراجعة.",
		txtNoteNotAsked:         "ربما لم تطلب هذا التغيير:",
		txtNoteMissing:          "قد يكون شيء مما طلبته غير موجود في هذه التغييرات.",
		txtPushChoose:           "لديك بالفعل محادثة حول هذا. اختر أين تتابع.",
		txtReceiptNotCorrection: "لا يبدو هذا تعديلاً على الإيصال، لذا بقيت المسودة كما هي. عدّل الحقول أدناه أو اذكر ما تريد تغييره، مثل «الإجمالي 12.40».",
		txtHintCategory:         "تم ضبط الفئة على «%s» التي تستخدمها بالفعل. غيّرها إن كانت خاطئة.",
		txtHintCategoryFit:      "قد لا تكون «%s» الفئة المناسبة لهذا الإيصال.",
		txtHintRefund:           "يبدو هذا استرداداً أو إرجاعاً. تحقق من إشارة المبالغ.",
		txtHintSamePurchase:     "قد تكون هذه نفس عملية الشراء من %s بتاريخ %s، المسجلة بالفعل في «%s».",
		txtHintTaxIncluded:      "تتطابق المبالغ إذا كانت الضريبة مشمولة في الأسعار. إن كان كذلك فحدّد «الضريبة مشمولة».",
		txtHintDiscountIncluded: "تتطابق المبالغ إذا كان الخصم مطروحاً من أسعار العناصر. إن كان كذلك فحدّد «الخصم مشمول».",
		txtNoteSheetChange:      "قد لا يطابق هذا التغيير في الجدول ما طلبته:",
	},
	"hi": {
		txtDone:                 "हो गया — आपके बदलाव सहेज दिए गए हैं।",
		txtStopped:              "रोक दिया गया। पूरे हो चुके बदलाव बने रहेंगे।",
		txtDiscarded:            "प्रस्ताव हटा दिया गया। कुछ भी नहीं बदला।",
		txtDataChanged:          "बाकी बदलाव लागू होने से पहले डेटा बदल गया। नया प्रस्ताव तैयार किया जा रहा है; पूरे हो चुके बदलाव बने रहेंगे।",
		txtContinuing:           "यह हिस्सा सहेज दिया गया है। आपके अनुरोध का बाकी हिस्सा जारी है।",
		txtReceiptConfirmed:     "रसीद का विवरण पक्का किया गया। अस्थायी तस्वीरें हटा दी गईं।",
		txtImageReviewDiscarded: "तस्वीर की समीक्षा हटा दी गई। अस्थायी तस्वीरें हटा दी गईं; निकाला गया ड्राफ़्ट डेटा बना रहेगा।",
		txtReceiptReview:        "नीचे दी गई रसीद देखें; हाइलाइट किए गए फ़ील्ड ठीक करें और चुनें कि इसे कहाँ सहेजना है। अलग-अलग आइटम न होने पर दुकान और कुल राशि एक सारांश आइटम के रूप में सहेजी जाएगी।",
		txtImageQuestion:        "आप इस तस्वीर के साथ क्या करना चाहेंगे?",
		txtReceiptRevised:       "मैंने रसीद का ड्राफ़्ट संशोधित किया है। शीट के बदलाव तैयार करने से पहले नीचे के फ़ील्ड देखें।",
		txtPreviousChanges:      "पिछले बदलाव",
		txtDiscardedChanges:     "हटाए गए बदलाव",
		txtPushReply:            "आपकी चैट में नया जवाब है।",
		txtPushReview:           "प्रस्तावित बदलाव देखें।",
		txtPushComplete:         "आपके बदलाव पूरे हो गए।",
		txtPushAttention:        "चैट पर ध्यान देने की ज़रूरत है। देखने या फिर से कोशिश करने के लिए इसे खोलें।",
		txtPushContinuing:       "आपके अनुरोध का एक हिस्सा सहेज दिया गया है; बाकी पर काम जारी है।",
		txtPushImage:            "आपकी तस्वीर समीक्षा के लिए तैयार है।",
		txtPushDuplicate:        "संभावित डुप्लिकेट रसीद देखें।",
		txtPushReceipt:          "आपकी रसीद लागू करने के लिए तैयार है।",
		txtPushReceiptAgain:     "आपकी रसीद को फिर से देखना होगा।",
		txtPushReceiptRevised:   "आपकी संशोधित रसीद समीक्षा के लिए तैयार है।",
		txtNoteNotAsked:         "हो सकता है आपने यह बदलाव नहीं माँगा था:",
		txtNoteMissing:          "आपने जो माँगा था उसमें से कुछ इन बदलावों में छूट गया हो सकता है।",
		txtPushChoose:           "इस बारे में आपकी पहले से एक चैट है। चुनें कि कहाँ जारी रखना है।",
		txtReceiptNotCorrection: "यह रसीद में बदलाव जैसा नहीं लगता, इसलिए ड्राफ़्ट वैसा ही है। नीचे के फ़ील्ड बदलें या बताएँ क्या बदलना है, जैसे “कुल 12.40 है”।",
		txtHintCategory:         "श्रेणी “%s” रखी गई है, जिसे आप पहले से इस्तेमाल करते हैं। गलत हो तो बदलें।",
		txtHintCategoryFit:      "“%s” शायद इस रसीद के लिए सही श्रेणी नहीं है।",
		txtHintRefund:           "यह रिफ़ंड या वापसी लगती है। राशियों का चिह्न जाँचें।",
		txtHintSamePurchase:     "यह %s की %s वाली खरीद जैसी हो सकती है, जो पहले से “%s” में है।",
		txtHintTaxIncluded:      "अगर टैक्स कीमतों में पहले से शामिल है तो राशियाँ मिलती हैं। ऐसा हो तो “टैक्स शामिल” चुनें।",
		txtHintDiscountIncluded: "अगर छूट कीमतों से पहले ही घटा दी गई है तो राशियाँ मिलती हैं। ऐसा हो तो “छूट शामिल” चुनें।",
		txtNoteSheetChange:      "यह शीट बदलाव शायद आपके अनुरोध से मेल नहीं खाता:",
	},
}

// tr returns a Timely-written text in the conversation's language, falling
// back to English for languages without a translation.
func tr(language, key string) string {
	if table, ok := texts[language]; ok {
		if text, ok := table[key]; ok {
			return text
		}
	}
	return texts["en"][key]
}

// supportedLanguage keeps the primary subtag of a BCP 47 tag ("pt-BR" → "pt").
func supportedLanguage(tag string) string {
	primary := strings.ToLower(strings.TrimSpace(strings.SplitN(strings.ReplaceAll(tag, "_", "-"), "-", 2)[0]))
	if _, ok := texts[primary]; ok {
		return primary
	}
	return ""
}

var nonLatinLanguages = map[string]bool{"ja": true, "zh": true, "ko": true, "ru": true, "ar": true, "hi": true}

// detectLanguage recognises languages by script. Latin-script text returns
// "latin": the model declares which Latin language it is when it proposes.
func detectLanguage(text string) string {
	counts := map[string]int{}
	letters := 0
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			counts["kana"]++
		case unicode.Is(unicode.Han, r):
			counts["han"]++
		case unicode.Is(unicode.Hangul, r):
			counts["ko"]++
		case unicode.Is(unicode.Cyrillic, r):
			counts["ru"]++
		case unicode.Is(unicode.Arabic, r):
			counts["ar"]++
		case unicode.Is(unicode.Devanagari, r):
			counts["hi"]++
		case unicode.Is(unicode.Latin, r):
			counts["latin"]++
		default:
			continue
		}
		letters++
	}
	if letters == 0 {
		return ""
	}
	if counts["kana"] > 0 {
		return "ja"
	}
	// A non-Latin script wins with a fifth of the letters, so a Japanese or
	// Russian sentence with an English product name still counts.
	best := ""
	for _, script := range []string{"han", "ko", "ru", "ar", "hi"} {
		if counts[script]*5 >= letters && (best == "" || counts[script] > counts[best]) {
			best = script
		}
	}
	switch best {
	case "":
		return "latin"
	case "han":
		return "zh"
	default:
		return best
	}
}

// noteLanguage updates the conversation language from a new message.
func noteLanguage(c *Conversation, text string) {
	switch detected := detectLanguage(text); detected {
	case "":
	case "latin":
		// Leave a Latin language the model declared (es, fr, …) alone.
		if c.Language == "" || nonLatinLanguages[c.Language] {
			c.Language = "en"
		}
	default:
		c.Language = detected
	}
}
