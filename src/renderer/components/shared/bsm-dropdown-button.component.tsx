import { useRef, useState } from "react"
import { BsmIconType, BsmIcon } from "../svgs/bsm-icon.component"
import { BsmButton } from "./bsm-button.component"
import { useTranslation } from "renderer/hooks/use-translation.hook"
import { AnimatePresence } from "framer-motion"
import { v4 as uuidv4 } from 'uuid';
import { useClickOutside } from "renderer/hooks/use-click-outside.hook"

export interface DropDownItem {text: string, icon?: BsmIconType, onClick?: () => void}

type Props = {
    className?: string, 
    items?: DropDownItem[], 
    align?: "left"|"right", 
    withBar?: boolean, 
    icon?: BsmIconType, 
    buttonClassName?: string, 
    menuTranslationY?: string|number
    children?: JSX.Element,
    text?: string,
    textClassName?: string
}

export function BsmDropdownButton({className, items, align, withBar = true, icon = "settings", buttonClassName, menuTranslationY, children, text, textClassName}: Props) {

   const [expanded, setExpanded] = useState(false)
   const t = useTranslation();
   const ref = useRef(null)
   useClickOutside(ref, () => setExpanded(false));

   const defaultButtonClassName = "relative z-[1] p-1 rounded-md text-inherit w-full h-full shadow-md shadow-black"

   const handleClickOutside = () => {
    if(children){ return; }
    setExpanded(false);
   }

   return (
      <div ref={ref} className={className}>
         <BsmButton onClick={() => setExpanded(!expanded)} className={buttonClassName ?? defaultButtonClassName} icon={icon} active={expanded} onClickOutside={handleClickOutside} withBar={withBar} text={text}/>
         <div className={`py-1 w-fit absolute cursor-pointer top-[calc(100%-4px)] rounded-md bg-inherit text-sm text-gray-800 dark:text-gray-200 shadow-md shadow-black transition-[scale] ease-in-out ${align === "left" ? "left-0 origin-top-left" : "right-0 origin-top-right"}`} style={{scale: expanded ? "1" : "0", translate: `0 ${menuTranslationY}`}}>
            { items?.map((i) => (
               <div key={uuidv4()} onClick={() => i.onClick?.()} className="flex w-full px-3 py-2 hover:backdrop-brightness-150">
                  {i.icon && <BsmIcon icon={i.icon} className="h-5 w-5 mr-1 text-inherit"/>}
                  <span className="w-max">{t(i.text)}</span>
               </div>
            ))}
         </div>
         {!!children && (
            <AnimatePresence>
                {expanded && (
                    children
                )}
            </AnimatePresence>
         )}
      </div>
  )
}
