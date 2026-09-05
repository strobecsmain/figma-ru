// The window's markup, kept as a string so the whole program stays one
// compilable set of .cs files with no build tooling beyond the C# compiler that
// ships with Windows.
//
// Values follow Figma's own dark UI: #1E1E1E canvas, #2C2C2C panels, #0D99FF for
// the primary action, 11px section captions, 6px corner radii.
namespace FigmaRu
{
    public static class Xaml
    {
        public const string Window = @"
<Window xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
        xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'
        Title='Figma на русском'
        Width='720' Height='700' MinWidth='620' MinHeight='520'
        WindowStartupLocation='CenterScreen'
        WindowStyle='None' ResizeMode='CanResize'
        Background='#FF1E1E1E'
        TextOptions.TextFormattingMode='Display' UseLayoutRounding='True'>

  <Window.Resources>
    <SolidColorBrush x:Key='Text'   Color='#FFFFFFFF'/>
    <SolidColorBrush x:Key='Dim'    Color='#FFB3B3B3'/>
    <SolidColorBrush x:Key='Faint'  Color='#FF8C8C8C'/>
    <SolidColorBrush x:Key='Panel'  Color='#FF2C2C2C'/>
    <SolidColorBrush x:Key='Edge'   Color='#FF444444'/>
    <SolidColorBrush x:Key='Blue'   Color='#FF0D99FF'/>

    <Style TargetType='TextBlock'>
      <Setter Property='FontFamily' Value='Inter, Segoe UI'/>
      <Setter Property='Foreground' Value='{StaticResource Text}'/>
      <Setter Property='FontSize' Value='12'/>
      <Setter Property='TextWrapping' Value='Wrap'/>
    </Style>

    <Style x:Key='Caption' TargetType='TextBlock'>
      <Setter Property='FontFamily' Value='Inter, Segoe UI'/>
      <Setter Property='FontSize' Value='10'/>
      <Setter Property='FontWeight' Value='SemiBold'/>
      <Setter Property='Foreground' Value='{StaticResource Faint}'/>
      <Setter Property='Margin' Value='0,0,0,10'/>
    </Style>

    <Style x:Key='Flat' TargetType='Button'>
      <Setter Property='FontFamily' Value='Inter, Segoe UI'/>
      <Setter Property='FontSize' Value='12'/>
      <Setter Property='Height' Value='32'/>
      <Setter Property='Padding' Value='14,0'/>
      <Setter Property='Foreground' Value='{StaticResource Text}'/>
      <Setter Property='Background' Value='Transparent'/>
      <Setter Property='BorderBrush' Value='{StaticResource Edge}'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <Border x:Name='bd' CornerRadius='6' Background='{TemplateBinding Background}'
                    BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='1'
                    Padding='{TemplateBinding Padding}'>
              <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property='IsMouseOver' Value='True'>
                <Setter TargetName='bd' Property='Background' Value='#FF383838'/>
              </Trigger>
              <Trigger Property='IsEnabled' Value='False'>
                <Setter Property='Opacity' Value='0.4'/>
                <Setter Property='Cursor' Value='Arrow'/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key='Primary' TargetType='Button' BasedOn='{StaticResource Flat}'>
      <Setter Property='Background' Value='{StaticResource Blue}'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <Border x:Name='bd' CornerRadius='6' Background='{TemplateBinding Background}'
                    Padding='{TemplateBinding Padding}'>
              <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property='IsMouseOver' Value='True'>
                <Setter TargetName='bd' Property='Background' Value='#FF0C8CE9'/>
              </Trigger>
              <Trigger Property='IsEnabled' Value='False'>
                <Setter Property='Opacity' Value='0.4'/>
                <Setter Property='Cursor' Value='Arrow'/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key='TitleBtn' TargetType='Button' BasedOn='{StaticResource Flat}'>
      <Setter Property='Height' Value='28'/>
      <Setter Property='Width' Value='34'/>
      <Setter Property='Padding' Value='0'/>
      <Setter Property='BorderBrush' Value='Transparent'/>
      <Setter Property='Foreground' Value='{StaticResource Dim}'/>
    </Style>

    <Style TargetType='CheckBox'>
      <Setter Property='FontFamily' Value='Inter, Segoe UI'/>
      <Setter Property='FontSize' Value='12'/>
      <Setter Property='Foreground' Value='{StaticResource Dim}'/>
      <Setter Property='Margin' Value='0,5'/>
      <Setter Property='Cursor' Value='Hand'/>
    </Style>

    <!-- The stock scrollbar is light grey and reads as a bug in a dark UI. -->
    <Style TargetType='ScrollBar'>
      <Setter Property='Width' Value='10'/>
      <Setter Property='Background' Value='Transparent'/>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='ScrollBar'>
            <Grid Background='Transparent'>
              <Track x:Name='PART_Track' IsDirectionReversed='True'>
                <Track.DecreaseRepeatButton>
                  <RepeatButton Command='ScrollBar.PageUpCommand' Opacity='0' Focusable='False'/>
                </Track.DecreaseRepeatButton>
                <Track.Thumb>
                  <Thumb>
                    <Thumb.Template>
                      <ControlTemplate TargetType='Thumb'>
                        <Border CornerRadius='5' Background='#FF4D4D4D' Margin='2,0'/>
                      </ControlTemplate>
                    </Thumb.Template>
                  </Thumb>
                </Track.Thumb>
                <Track.IncreaseRepeatButton>
                  <RepeatButton Command='ScrollBar.PageDownCommand' Opacity='0' Focusable='False'/>
                </Track.IncreaseRepeatButton>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key='Card' TargetType='Border'>
      <Setter Property='Background' Value='{StaticResource Panel}'/>
      <Setter Property='BorderBrush' Value='{StaticResource Edge}'/>
      <Setter Property='BorderThickness' Value='1'/>
      <Setter Property='CornerRadius' Value='6'/>
      <Setter Property='Padding' Value='16'/>
      <Setter Property='Margin' Value='0,0,0,12'/>
    </Style>
  </Window.Resources>

  <Border BorderBrush='#FF444444' BorderThickness='1'>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height='Auto'/>
        <RowDefinition Height='*'/>
      </Grid.RowDefinitions>

      <Grid x:Name='TitleBar' Grid.Row='0' Background='#FF1E1E1E' Height='44'>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width='*'/>
          <ColumnDefinition Width='Auto'/>
        </Grid.ColumnDefinitions>
        <TextBlock Grid.Column='0' Text='Figma на русском' VerticalAlignment='Center'
                   Margin='16,0,0,0' FontWeight='SemiBold' Foreground='#FFB3B3B3'/>
        <StackPanel Grid.Column='1' Orientation='Horizontal' Margin='0,0,6,0'>
          <Button x:Name='BtnMin' Style='{StaticResource TitleBtn}' Content='—'/>
          <Button x:Name='BtnClose' Style='{StaticResource TitleBtn}' Content='✕'/>
        </StackPanel>
      </Grid>

      <ScrollViewer Grid.Row='1' VerticalScrollBarVisibility='Auto' Padding='24,8,24,24'>
        <StackPanel>

          <StackPanel Orientation='Horizontal' Margin='0,0,0,20'>
            <Canvas Width='24' Height='36' Margin='0,0,12,0'>
              <Path Fill='#FF0ACF83' Data='M6,36 A6,6 0 0 0 12,30 L12,24 L6,24 A6,6 0 0 0 6,36 Z'/>
              <Path Fill='#FFA259FF' Data='M0,18 A6,6 0 0 1 6,12 L12,12 L12,24 L6,24 A6,6 0 0 1 0,18 Z'/>
              <Path Fill='#FFF24E1E' Data='M0,6 A6,6 0 0 1 6,0 L12,0 L12,12 L6,12 A6,6 0 0 1 0,6 Z'/>
              <Path Fill='#FFFF7262' Data='M12,0 L18,0 A6,6 0 0 1 18,12 L12,12 Z'/>
              <Path Fill='#FF1ABCFE' Data='M24,18 A6,6 0 1 1 12,18 A6,6 0 0 1 24,18 Z'/>
            </Canvas>
            <StackPanel VerticalAlignment='Center'>
              <TextBlock Text='Figma на русском' FontSize='16' FontWeight='SemiBold'/>
              <TextBlock Text='Перевод меню, диалогов и интерфейса редактора'
                         FontSize='11' Foreground='{StaticResource Faint}' Margin='0,2,0,0'/>
            </StackPanel>
          </StackPanel>

          <Border x:Name='NoticeBox' Style='{StaticResource Card}' Visibility='Collapsed'
                  BorderBrush='Transparent' Padding='14'>
            <TextBlock x:Name='NoticeText'/>
          </Border>

          <Border Style='{StaticResource Card}'>
            <StackPanel>
              <TextBlock Style='{StaticResource Caption}' Text='УСТАНОВЛЕННЫЕ ВЕРСИИ'/>
              <StackPanel x:Name='BuildList'/>
            </StackPanel>
          </Border>

          <Border Style='{StaticResource Card}'>
            <StackPanel>
              <TextBlock Style='{StaticResource Caption}' Text='ПАРАМЕТРЫ'/>
              <CheckBox x:Name='ChkShellOnly' Content='Только меню и диалоги, без перевода редактора'/>
              <CheckBox x:Name='ChkAll' Content='Все установленные сборки, а не только последние'/>
              <StackPanel Orientation='Horizontal' Margin='0,12,0,0'>
                <Button x:Name='BtnInstall' Style='{StaticResource Primary}'
                        Content='Установить русский' Margin='0,0,8,0'/>
                <Button x:Name='BtnUninstall' Style='{StaticResource Flat}'
                        Content='Вернуть английский' Margin='0,0,8,0'/>
                <Button x:Name='BtnRefresh' Style='{StaticResource Flat}' Content='Обновить'/>
              </StackPanel>
              <TextBlock Margin='0,10,0,0' FontSize='11' Foreground='{StaticResource Faint}'
                         Text='Figma должна быть закрыта. Значок Figma Agent в трее закрывать не нужно.'/>
            </StackPanel>
          </Border>

          <Border Style='{StaticResource Card}'>
            <StackPanel>
              <TextBlock Style='{StaticResource Caption}' Text='ХОД РАБОТЫ'/>
              <TextBlock x:Name='StatusText' Margin='0,0,0,8' Text='Готов к работе.'
                         Foreground='{StaticResource Dim}'/>
              <Border Background='#FF181818' BorderBrush='{StaticResource Edge}'
                      BorderThickness='1' CornerRadius='6' Padding='10'>
                <ScrollViewer x:Name='LogScroll' Height='170' VerticalScrollBarVisibility='Auto'>
                  <TextBlock x:Name='LogText' FontFamily='Consolas' FontSize='11'
                             Foreground='{StaticResource Dim}'/>
                </ScrollViewer>
              </Border>
              <TextBlock Margin='0,10,0,0' FontSize='11' Foreground='{StaticResource Faint}'
                         Text='После каждого обновления Figma перевод нужно ставить заново — просто откройте эту программу ещё раз.'/>
            </StackPanel>
          </Border>

        </StackPanel>
      </ScrollViewer>
    </Grid>
  </Border>
</Window>";
    }
}
