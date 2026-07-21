library(shiny)

##

# ---- Your existing analysis code ----

analyse_data <- function(x, multiplier) {
  result <- x * multiplier
  return(result)
}

# ---- User interface ----

ui <- fluidPage(
  titlePanel("H&W Image Renaming"),
  
  numericInput(
    inputId = "x",
    label = "Enter a number:",
    value = 10
  ),
  
  sliderInput(
    inputId = "multiplier",
    label = "Multiplier:",
    min = 1,
    max = 10,
    value = 2
  ),
  
  actionButton(
    inputId = "run",
    label = "Run analysis"
  ),
  
  hr(),
  
  textOutput("result")
)

# ---- Server logic ----

server <- function(input, output, session) {
  
  result <- eventReactive(input$run, {
    analyse_data(
      x = input$x,
      multiplier = input$multiplier
    )
  })
  
  output$result <- renderText({
    paste("Result:", result())
  })
}

shinyApp(ui, server)