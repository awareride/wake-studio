/**
 * Icon set - Radix UI icons (https://www.radix-ui.com/icons).
 *
 * Thin wrappers over `@radix-ui/react-icons` that keep the legacy local API
 * (`size` prop, `IconX` names) so existing call sites work unchanged. Radix
 * icons are filled and inherit `currentColor`, so they pick up text color
 * utilities exactly like the old stroke-based set.
 *
 * Note: Radix ships no mic/folder/terminal/flask glyphs; closest matches are
 * used where needed (see each export below).
 */

import type { ComponentType, SVGProps } from 'react'
import type { IconProps as RadixIconProps } from '@radix-ui/react-icons/dist/types'
import {
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  Component2Icon,
  CubeIcon,
  GearIcon,
  HamburgerMenuIcon,
  MagicWandIcon,
  MixIcon,
  PlayIcon,
  ReaderIcon,
  ReloadIcon,
  StackIcon,
  StopIcon,
  ViewGridIcon,
} from '@radix-ui/react-icons'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Wrap a Radix icon, mapping the legacy `size` prop to width/height. */
function fromRadix(RadixIcon: ComponentType<RadixIconProps>) {
  function Icon(props: IconProps) {
    const { size = 18, children: _children, ...rest } = props
    return <RadixIcon width={size} height={size} aria-hidden {...rest} />
  }
  return Icon
}

/** Workspace (2x2 grid view). */
export const IconWorkspace = fromRadix(ViewGridIcon)

/** Model Registry (book / reader). */
export const IconLibrary = fromRadix(ReaderIcon)

/** Projects (Radix has no folder; archive box is the closest match). */
export const IconFolder = fromRadix(ArchiveIcon)

export const IconSettings = fromRadix(GearIcon)

/** Device SDK (chip: rounded rect with edge pins). */
export const IconChip = fromRadix(Component2Icon)

export const IconStop = fromRadix(StopIcon)

export const IconPlay = fromRadix(PlayIcon)

/** Spinner (Radix reload arrows spun via CSS animation). */
export function IconSpinner(props: IconProps) {
  const { size = 18, className, children: _children, ...rest } = props
  return (
    <ReloadIcon
      width={size}
      height={size}
      className={`animate-spin ${className ?? ''}`}
      aria-hidden
      {...rest}
    />
  )
}

export const IconChevronRight = fromRadix(ChevronRightIcon)

/** Left chevron (Back navigation, issue #105). */
export const IconChevronLeft = fromRadix(ChevronLeftIcon)

export const IconMenu = fromRadix(HamburgerMenuIcon)

/** Training (Radix has no flask; the beaker-with-liquid half of MixIcon). */
export const IconTrain = fromRadix(MixIcon)

/** Datasets (stacked layers — the dataset console, between Training and Backends). */
export const IconDataset = fromRadix(StackIcon)

export const IconServer = fromRadix(CubeIcon)

/** Console (Radix has no terminal; code brackets are the closest match). */
export const IconConsole = fromRadix(CodeIcon)

/** A wizard wand with sparkles (the "New train" trigger, issue #105). */
export const IconWand = fromRadix(MagicWandIcon)
